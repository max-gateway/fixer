import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config.js';
import { Database } from '../db/database.service.js';

/** Só uma réplica publica por vez: preserva a ordem do outbox. */
const RELAY_LOCK_KEY = 7_201_007;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: string;
  payload: unknown;
}

/**
 * Publica `event_outbox` no Redis Stream (at-least-once: crash entre o XADD e o UPDATE republica,
 * e o consumidor deduplica por `id`). Sem REDIS_URL o relay fica desligado e os eventos esperam na
 * tabela — nada se perde, só não anda até configurar.
 */
@Injectable()
export class EventRelay implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EventRelay.name);
  private redis?: Redis;
  private running = false;
  private loop: Promise<void> | null = null;
  private lastCleanup = 0;

  constructor(
    private readonly db: Database,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit(): void {
    const { redisUrl, stream } = this.cfg.events;
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL ausente: eventos de entrada ficam no outbox e NÃO chegam à API até configurar.',
      );
      return;
    }
    this.redis = new Redis(redisUrl, {
      retryStrategy: (n) => Math.min(n * 500, 5_000),
      maxRetriesPerRequest: null,
    });
    this.redis.on('error', (e) => this.logger.warn(`Redis: ${e.message}`));
    this.running = true;
    this.loop = this.run();
    this.logger.log(`Relay de eventos publicando em "${stream}".`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
    this.redis?.disconnect();
  }

  private async run(): Promise<void> {
    const { batchSize } = this.cfg.events;
    while (this.running) {
      let published = 0;
      try {
        published = await this.publishBatch();
        await this.cleanupIfDue();
      } catch (err) {
        this.logger.error(
          `Falha no ciclo do relay: ${(err as Error).message}`,
        );
        await sleep(1_000);
        continue;
      }
      if (published < batchSize) await sleep(published === 0 ? 500 : 50);
    }
  }

  /** Retorna quantos eventos foram publicados neste ciclo. */
  async publishBatch(): Promise<number> {
    const { stream, maxLen, batchSize } = this.cfg.events;
    return this.db.tx(async (c) => {
      const lock = await c.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1) AS locked',
        [RELAY_LOCK_KEY],
      );
      if (!lock.rows[0]?.locked) return 0; // outra réplica está publicando

      const { rows } = await c.query<Row>(
        `SELECT id, payload FROM event_outbox
          WHERE published_at IS NULL ORDER BY seq ASC LIMIT $1`,
        [batchSize],
      );
      if (rows.length === 0) return 0;

      const pipeline = this.redis!.pipeline();
      for (const r of rows) {
        pipeline.xadd(
          stream,
          'MAXLEN',
          '~',
          maxLen,
          '*',
          'data',
          JSON.stringify(r.payload),
        );
      }
      const results = await pipeline.exec();
      const failed = results?.find(([err]) => err);
      if (failed) throw failed[0]; // aborta: nada é marcado, o lote se repete

      await c.query(
        'UPDATE event_outbox SET published_at = now() WHERE id = ANY($1::uuid[])',
        [rows.map((r) => r.id)],
      );
      return rows.length;
    });
  }

  private async cleanupIfDue(): Promise<void> {
    if (Date.now() - this.lastCleanup < 3_600_000) return;
    this.lastCleanup = Date.now();
    await this.db.query(
      `DELETE FROM event_outbox
        WHERE published_at < now() - ($1 || ' hours')::interval`,
      [String(this.cfg.events.retentionHours)],
    );
  }
}
