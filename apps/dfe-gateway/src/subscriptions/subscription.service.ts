import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, AuditService } from '../audit/audit.service.js';
import type { CompanyRow } from '../companies/company.service.js';
import { CONFIG, type AppConfig } from '../config/config.js';
import { KEY_PROVIDER } from '../credentials/credential.service.js';
import type { KeyProvider } from '../core/crypto/key-provider.js';
import { seal } from '../core/crypto/secret-box.js';
import { Database } from '../db/database.service.js';
import { WEBHOOK_SECRET_CONTEXT } from '../delivery/relay.service.js';
import { assertSafeWebhook, UnsafeTargetError } from '../delivery/ssrf.js';
import { routingKey, streamName } from '../delivery/transports.js';

export const SubscriptionSchema = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('PULL') }),
  z.object({ transport: z.literal('WEBHOOK'), target: z.object({ url: z.string().url().max(2048) }) }),
  z.object({ transport: z.literal('RABBITMQ') }),
  z.object({ transport: z.literal('REDIS_STREAM') }),
]);

export const AckSchema = z.object({ nsu: z.string().regex(/^\d{1,18}$/, 'nsu deve ser numérico') });

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Escolhe como o tenant é avisado. O destino de RABBITMQ/REDIS_STREAM é derivado do slug do tenant (nunca
   * escolhido por ele): um tenant não consegue publicar nem ler a fila de outro. WEBHOOK devolve um segredo
   * novo UMA vez (cada PUT rotaciona).
   */
  async put(actor: Actor, company: CompanyRow, body: z.infer<typeof SubscriptionSchema>) {
    let secret: string | null = null;
    let sealed: { keyId: string; blob: Buffer } | null = null;
    let target: object = {};

    if (body.transport === 'WEBHOOK') {
      if (!this.keys.available) throw new BadRequestException('Chave de criptografia do gateway não configurada');
      try {
        await assertSafeWebhook(body.target.url, this.cfg.allowInsecureWebhooks);
      } catch (e) {
        if (e instanceof UnsafeTargetError) throw new BadRequestException(e.message);
        throw e;
      }
      secret = randomBytes(32).toString('hex');
      sealed = await seal(this.keys, Buffer.from(secret, 'utf8'), WEBHOOK_SECRET_CONTEXT);
      target = { url: body.target.url };
    }
    if (body.transport === 'RABBITMQ' && !this.cfg.rabbit) throw new BadRequestException('RabbitMQ não está habilitado neste gateway');
    if (body.transport === 'REDIS_STREAM' && !this.cfg.redisUrl) throw new BadRequestException('Redis Streams não está habilitado neste gateway');

    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO subscriptions (company_id, tenant_id, transport, target, secret_ciphertext, secret_key_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE')
       ON CONFLICT (company_id, tenant_id) DO UPDATE SET
         transport = EXCLUDED.transport, target = EXCLUDED.target, secret_ciphertext = EXCLUDED.secret_ciphertext,
         secret_key_id = EXCLUDED.secret_key_id, status = 'ACTIVE'
       RETURNING id`,
      [company.id, actor.tenantId, body.transport, JSON.stringify(target), sealed?.blob ?? null, sealed?.keyId ?? null],
    );
    await this.audit.record(actor, 'subscription.put', company.id, { transport: body.transport });

    return {
      transport: body.transport,
      ...(body.transport === 'WEBHOOK' ? { target, secret } : {}),
      ...(body.transport === 'RABBITMQ' ? { exchange: this.cfg.rabbit!.exchange, routingKey: routingKey(actor.tenantSlug, company.cnpj) } : {}),
      ...(body.transport === 'REDIS_STREAM' ? { stream: streamName(actor.tenantSlug) } : {}),
      subscriptionId: rows[0]!.id,
    };
  }

  /** Confirma que o consumidor processou tudo até `nsu`. Nunca retrocede e nunca passa do que o gateway já tem. */
  async ack(actor: Actor, company: CompanyRow, nsu: bigint) {
    const state = await this.db.query<{ last_nsu: string }>('SELECT last_nsu::text FROM sync_state WHERE company_id = $1', [company.id]);
    if (nsu > BigInt(state.rows[0]?.last_nsu ?? '0')) throw new BadRequestException('nsu maior que o último NSU do gateway');
    const { rows } = await this.db.query<{ acked_nsu: string }>(
      `UPDATE subscriptions SET acked_nsu = GREATEST(acked_nsu, $3) WHERE company_id = $1 AND tenant_id = $2 RETURNING acked_nsu::text`,
      [company.id, actor.tenantId, nsu.toString()],
    );
    return { ackedNsu: rows[0]?.acked_nsu ?? '0' };
  }

  async get(actor: Actor, company: CompanyRow) {
    const { rows } = await this.db.query(
      `SELECT transport, target, status, acked_nsu::text AS "ackedNsu" FROM subscriptions WHERE company_id = $1 AND tenant_id = $2`,
      [company.id, actor.tenantId],
    );
    return rows[0] ?? null;
  }
}
