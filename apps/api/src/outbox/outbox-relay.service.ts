import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

/** Chave do advisory lock: só uma réplica da API publica por vez, o que preserva a ordem do outbox. */
const RELAY_LOCK_KEY = 7_201_001;

interface Row {
  id: string;
  seq: bigint;
  payload: unknown;
}

/**
 * Publica as linhas pendentes do OutboxEvent no Redis Stream (at-least-once:
 * um crash entre o XADD e o UPDATE republica o evento; o consumidor deduplica
 * por `id`). Em cada ciclo, uma transação segura o advisory lock, lê o lote em
 * ordem de `seq`, faz XADD e marca `publishedAt`.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly streamName = process.env.ORDER_EVENTS_STREAM ?? 'fixer:order-events';
  private readonly maxLen = Number(process.env.ORDER_EVENTS_STREAM_MAXLEN ?? 100_000);
  private readonly batchSize = 100;
  private readonly idleMs = 500;
  private readonly retentionHours = 72;
  private redis!: Redis;
  private running = false;
  private loop: Promise<void> | null = null;
  private lastCleanup = 0;

  /** Cliente de sistema (ignora RLS): o relay publica a outbox de TODAS as organizações, em ordem de `seq`. */
  constructor(private readonly prisma: SystemPrismaService) {}

  onModuleInit(): void {
    if (process.env.OUTBOX_RELAY_ENABLED === 'false') return;
    this.redis = new Redis(process.env.REDIS_URL ?? process.env.PLATE_READER_REDIS_URL ?? 'redis://localhost:6379/0', {
      retryStrategy: (times) => Math.min(times * 500, 5000),
      maxRetriesPerRequest: null,
    });
    this.redis.on('error', (err) => this.logger.warn(`Redis: ${err.message}`));
    this.running = true;
    this.loop = this.run();
    this.logger.log(`Outbox relay publicando em "${this.streamName}".`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
    this.redis?.disconnect();
  }

  private async run(): Promise<void> {
    while (this.running) {
      let published = 0;
      try {
        published = await this.publishBatch();
        await this.cleanupIfDue();
      } catch (err) {
        this.logger.error('Falha no ciclo do outbox, tentando novamente', err as Error);
      }
      if (published < this.batchSize) await new Promise((r) => setTimeout(r, published === 0 ? this.idleMs : 50));
    }
  }

  /** Retorna quantos eventos foram publicados neste ciclo. */
  async publishBatch(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${RELAY_LOCK_KEY}) AS locked`;
        if (!lock?.locked) return 0; // outra réplica está publicando

        const rows = await tx.$queryRaw<Row[]>`
          SELECT "id", "seq", "payload" FROM "OutboxEvent"
          WHERE "publishedAt" IS NULL ORDER BY "seq" ASC LIMIT ${this.batchSize}`;
        if (rows.length === 0) return 0;

        const pipeline = this.redis.pipeline();
        for (const row of rows) {
          pipeline.xadd(this.streamName, 'MAXLEN', '~', this.maxLen, '*', 'data', JSON.stringify(row.payload));
        }
        const results = await pipeline.exec();
        const failed = results?.find(([err]) => err);
        if (failed) throw failed[0]; // aborta: nada marcado como publicado, o lote é repetido

        await tx.$executeRaw`UPDATE "OutboxEvent" SET "publishedAt" = now() WHERE "id" = ANY(${rows.map((r) => r.id)})`;
        return rows.length;
      },
      { timeout: 15_000 },
    );
  }

  /** Remove eventos já publicados após a janela de retenção (1x por hora por réplica). */
  private async cleanupIfDue(): Promise<void> {
    if (Date.now() - this.lastCleanup < 3_600_000) return;
    this.lastCleanup = Date.now();
    const cutoff = new Date(Date.now() - this.retentionHours * 3_600_000);
    const { count } = await this.prisma.outboxEvent.deleteMany({ where: { publishedAt: { lt: cutoff } } });
    if (count > 0) this.logger.log(`Outbox: ${count} eventos antigos removidos.`);
  }
}
