import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { KEY_PROVIDER } from '../credentials/credential.service.js';
import type { KeyProvider } from '../core/crypto/key-provider.js';
import { open } from '../core/crypto/secret-box.js';
import { Database } from '../db/database.service.js';
import { Metrics } from '../health/metrics.service.js';
import { DeliveryError, type DeliveryMessage, Transports } from './transports.js';

export const WEBHOOK_SECRET_CONTEXT = 'dfe-subscription:webhook-secret';
/** Depois disto a entrega vira DEAD e a assinatura FAILING; o consumidor se recupera pelo cursor (spec §7.3). */
export const MAX_DELIVERY_ATTEMPTS = 24;
const POLL_MS = 2_000;
const BATCH = 20;
const LEASE_SQL = `interval '2 minutes'`;

/** 1 min, 2, 4 … teto de 6 h, com jitter de ±20% para os consumidores não voltarem todos juntos. */
export function deliveryBackoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(2 ** Math.max(0, attempts - 1) * 60_000, 6 * 3_600_000);
  return Math.round(base * (0.8 + random() * 0.4));
}

interface Claimed {
  id: string;
  subscription_id: string;
  from_nsu: string;
  to_nsu: string;
  attempts: number;
}

interface SubInfo {
  transport: 'WEBHOOK' | 'RABBITMQ' | 'REDIS_STREAM';
  target: { url?: string };
  secret_ciphertext: Buffer | null;
  secret_key_id: string | null;
  slug: string;
  cnpj: string;
}

/**
 * Relay do outbox: lê as entregas vencidas, publica pelo transporte da assinatura e marca como entregue.
 * Entrega at-least-once: o aviso pode repetir (o consumidor deduplica por `messageId`), mas nunca se perde
 * sem que o cursor continue disponível.
 */
@Injectable()
export class RelayService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RelayService.name);
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    private readonly transports: Transports,
    private readonly metrics: Metrics,
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.runWorker) return;
    this.running = true;
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let n = 0;
      try {
        n = await this.drain();
      } catch (err) {
        this.logger.error(`Relay falhou: ${(err as Error).message}`);
      }
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  /** Processa um lote de entregas vencidas; devolve quantas tratou. */
  async drain(now: Date = new Date()): Promise<number> {
    const { rows } = await this.db.query<Claimed>(
      `UPDATE deliveries SET locked_until = now() + ${LEASE_SQL}
        WHERE id IN (SELECT id FROM deliveries
                      WHERE state = 'PENDING' AND next_attempt_at <= $2 AND (locked_until IS NULL OR locked_until < now())
                      ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id::text, subscription_id, from_nsu::text, to_nsu::text, attempts`,
      [BATCH, now],
    );
    await Promise.all(rows.map((d) => this.deliver(d, now)));
    return rows.length;
  }

  private async deliver(d: Claimed, now: Date): Promise<void> {
    const attempts = d.attempts + 1;
    try {
      const { rows } = await this.db.query<SubInfo>(
        `SELECT s.transport, s.target, s.secret_ciphertext, s.secret_key_id, t.slug, c.cnpj
           FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id JOIN companies c ON c.id = s.company_id
          WHERE s.id = $1 AND s.status = 'ACTIVE' AND t.status = 'ACTIVE'`,
        [d.subscription_id],
      );
      const sub = rows[0];
      if (!sub) return void (await this.finish(d, 'DEAD', attempts, 'Assinatura inativa'));
      const secret = sub.secret_ciphertext && sub.secret_key_id ? (await open(this.keys, sub.secret_key_id, sub.secret_ciphertext, WEBHOOK_SECRET_CONTEXT)).toString('utf8') : null;
      const msg: DeliveryMessage = {
        v: 1,
        messageId: `${d.subscription_id}:${d.to_nsu}`,
        companyCnpj: sub.cnpj,
        fromNsu: d.from_nsu,
        toNsu: d.to_nsu,
        emittedAt: now.toISOString(),
      };
      await this.transports.send({ transport: sub.transport, tenantSlug: sub.slug, target: sub.target, secret }, msg);
      await this.finish(d, 'DELIVERED', attempts, null);
      this.metrics.deliveries.inc({ transport: sub.transport, result: 'sent' });
    } catch (err) {
      const e = err instanceof DeliveryError ? err : new DeliveryError((err as Error).message);
      const dead = !e.retryable || attempts >= MAX_DELIVERY_ATTEMPTS;
      if (dead) {
        await this.finish(d, 'DEAD', attempts, e.message);
        await this.db.query(`UPDATE subscriptions SET status = 'FAILING' WHERE id = $1`, [d.subscription_id]);
        this.logger.error(`Entrega ${d.id} (assinatura ${d.subscription_id}) morreu: ${e.message}`);
      } else {
        await this.db.query(`UPDATE deliveries SET attempts = $2, last_error = $3, next_attempt_at = $4, locked_until = NULL WHERE id = $1`, [
          d.id,
          attempts,
          e.message,
          new Date(now.getTime() + deliveryBackoffMs(attempts)),
        ]);
      }
      this.metrics.deliveries.inc({ transport: 'any', result: dead ? 'dead' : 'retry' });
    }
  }

  /**
   * Fecha a entrega. Se novos documentos ampliaram `to_nsu` enquanto publicávamos, a linha continua PENDING
   * (vai de novo, sem penalizar o consumidor com tentativas).
   */
  private async finish(d: Claimed, state: 'DELIVERED' | 'DEAD', attempts: number, error: string | null): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE deliveries SET state = $2, attempts = $3, last_error = $4, locked_until = NULL,
              delivered_at = CASE WHEN $2 = 'DELIVERED' THEN now() END
        WHERE id = $1 AND to_nsu = $5::bigint`,
      [d.id, state, attempts, error, d.to_nsu],
    );
    if (!rowCount) {
      await this.db.query(`UPDATE deliveries SET attempts = 0, next_attempt_at = now(), locked_until = NULL WHERE id = $1`, [d.id]);
    } else if (state === 'DELIVERED') {
      await this.db.query(`UPDATE subscriptions SET status = 'ACTIVE' WHERE id = $1 AND status = 'FAILING'`, [d.subscription_id]);
    }
  }
}
