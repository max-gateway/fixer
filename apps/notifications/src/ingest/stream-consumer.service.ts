import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config.js';
import { OrderEventSchema } from '../contract/order-event.js';
import { Metrics } from '../health/metrics.service.js';
import { IngestService } from './ingest.service.js';

type StreamEntry = [id: string, fields: string[]];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Consome `fixer:order-events` com consumer group (várias réplicas, retomada após
 * restart, reivindicação de mensagens órfãs via XAUTOCLAIM).
 *
 * Política de falha:
 *  - payload ilegível / contrato inválido / versão desconhecida -> DLQ + ACK (nunca vai funcionar);
 *  - falha transitória (banco fora do ar) -> sem ACK; a mensagem fica pendente e é reentregue;
 *  - mais de `maxDeliveries` entregas -> DLQ + ACK (poison message não trava o grupo).
 * A DLQ (`<stream>:dlq`) guarda o original + motivo para inspeção e replay manual.
 */
@Injectable()
export class StreamConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StreamConsumer.name);
  /** Conexão dedicada às leituras bloqueantes (XREADGROUP BLOCK); comandos usam `cmd`. */
  private reader!: Redis;
  private cmd!: Redis;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly ingest: IngestService,
    private readonly metrics: Metrics,
  ) {}

  /** Usado pelo readiness probe. */
  async ping(): Promise<void> {
    await this.cmd.ping();
  }

  async onModuleInit(): Promise<void> {
    const opts = { retryStrategy: (n: number) => Math.min(n * 500, 5_000), maxRetriesPerRequest: null };
    this.reader = new Redis(this.cfg.redisUrl, opts);
    this.cmd = new Redis(this.cfg.redisUrl, opts);
    for (const r of [this.reader, this.cmd]) r.on('error', (e) => this.logger.warn(`Redis: ${e.message}`));

    try {
      // Começa em "0": eventos publicados antes do primeiro boot do serviço também são entregues.
      await this.cmd.xgroup('CREATE', this.cfg.stream.name, this.cfg.stream.group, '0', 'MKSTREAM');
      this.logger.log(`Grupo "${this.cfg.stream.group}" criado em "${this.cfg.stream.name}".`);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err;
    }

    this.running = true;
    this.loop = this.run();
    this.logger.log(`Consumindo "${this.cfg.stream.name}" como ${this.cfg.stream.consumer}.`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
    this.reader?.disconnect();
    await this.cmd?.quit().catch(() => undefined);
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.reclaimOrphans();
        await this.readNew();
      } catch (err) {
        this.logger.error(`Loop de consumo falhou: ${(err as Error).message}`);
        await sleep(1_000); // evita busy-loop se o Redis estiver fora
      }
    }
  }

  private async readNew(): Promise<void> {
    const { stream } = this.cfg;
    const res = (await this.reader.xreadgroup(
      'GROUP', stream.group, stream.consumer,
      'COUNT', stream.batchSize, 'BLOCK', stream.blockMs,
      'STREAMS', stream.name, '>',
    )) as [string, StreamEntry[]][] | null;
    if (!res) return;
    for (const [, entries] of res) for (const entry of entries) await this.handle(entry);
  }

  /** Mensagens entregues a um consumer que morreu antes do ACK. */
  private async reclaimOrphans(): Promise<void> {
    const { stream } = this.cfg;
    const [, entries] = (await this.cmd.xautoclaim(
      stream.name, stream.group, stream.consumer, stream.claimIdleMs, '0', 'COUNT', stream.batchSize,
    )) as [string, StreamEntry[], string[]];

    for (const entry of entries) {
      if ((await this.deliveryCount(entry[0])) > stream.maxDeliveries) {
        await this.deadLetter(entry, `excedeu ${stream.maxDeliveries} entregas`);
        continue;
      }
      await this.handle(entry);
    }
  }

  private async handle([id, fields]: StreamEntry): Promise<void> {
    const raw = fields[fields.indexOf('data') + 1];
    let parsed: ReturnType<typeof OrderEventSchema.safeParse>;
    try {
      parsed = OrderEventSchema.safeParse(JSON.parse(raw));
    } catch {
      return this.deadLetter([id, fields], 'JSON inválido');
    }
    if (!parsed.success) return this.deadLetter([id, fields], `contrato inválido: ${parsed.error.issues[0]?.message}`);

    const event = parsed.data;
    try {
      const result = await this.ingest.ingest(event);
      this.metrics.eventsConsumed.inc({ type: event.type, result: result.duplicate ? 'duplicate' : 'processed' });
      await this.cmd.xack(this.cfg.stream.name, this.cfg.stream.group, id);
    } catch (err) {
      // Sem ACK: reentrega via XAUTOCLAIM. O inbox garante que reprocessar é seguro.
      this.logger.error(`Falha ao ingerir ${event.type} ${event.id} (stream ${id}); será reentregue: ${(err as Error).message}`);
    }
  }

  private async deadLetter([id, fields]: StreamEntry, reason: string): Promise<void> {
    const { stream } = this.cfg;
    this.logger.error(`DLQ: mensagem ${id} — ${reason}`);
    await this.cmd.xadd(stream.dlq, '*', 'reason', reason, 'originalId', id, 'failedAt', new Date().toISOString(), ...fields);
    await this.cmd.xack(stream.name, stream.group, id);
    this.metrics.eventsConsumed.inc({ type: 'unknown', result: 'dead_lettered' });
  }

  private async deliveryCount(id: string): Promise<number> {
    const { stream } = this.cfg;
    const rows = (await this.cmd.xpending(stream.name, stream.group, id, id, 1)) as [string, string, number, number][];
    return rows[0]?.[3] ?? 0;
  }
}
