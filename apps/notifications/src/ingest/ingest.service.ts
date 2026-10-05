import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import type { OrderEvent } from '../contract/order-event.js';
import { Database } from '../db/database.service.js';
import { InboxBus, type InboxItem } from '../inbox/inbox.bus.js';
import { route } from '../routing/rules.js';

export type IngestResult = { duplicate: true } | { duplicate: false; created: number; suppressed: number };

export const dedupKey = (eventId: string, ruleId: string, channel: string, recipient: string) =>
  createHash('sha256').update(`${eventId}|${ruleId}|${channel}|${recipient}`).digest('hex');

/**
 * Transforma um evento em notificações enfileiradas, de forma ATÔMICA e IDEMPOTENTE:
 *  1. `inbox` registra o event_id (PK) — evento repetido (at-least-once) é descartado aqui;
 *  2. as intenções entram em `notifications` com dedup_key única (rede de segurança extra);
 *  3. tudo na mesma transação — o ACK do stream só acontece depois do COMMIT.
 * O envio externo NÃO acontece aqui (ver Dispatcher): ingerir é rápido e independente de provedor.
 * Exceção: `inapp` nasce já entregue (SENT) e é avisado em tempo real depois do COMMIT.
 */
@Injectable()
export class IngestService {
  constructor(
    private readonly db: Database,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly bus: InboxBus,
  ) {}

  async ingest(event: OrderEvent): Promise<IngestResult> {
    const intents = route(event, { brand: this.cfg.brand, webhooks: this.cfg.webhooks, whatsapp: !!this.cfg.whatsapp });
    const live: { recipient: string; item: InboxItem }[] = [];

    const result = await this.db.tx(async (c) => {
      const inbox = await c.query('INSERT INTO inbox (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        event.id,
        event.type,
      ]);
      if (inbox.rowCount === 0) return { duplicate: true as const };

      let created = 0;
      let suppressed = 0;
      for (const i of intents) {
        const isInApp = i.channel === 'inapp';
        const blocked = isInApp
          ? { rowCount: 0 }
          : await c.query('SELECT 1 FROM suppressions WHERE channel = $1 AND recipient = $2', [i.channel, i.recipient]);
        const isSuppressed = (blocked.rowCount ?? 0) > 0;
        const status = isInApp ? 'SENT' : isSuppressed ? 'SUPPRESSED' : 'PENDING';

        const res = await c.query<{ id: string; created_at: Date }>(
          `INSERT INTO notifications
             (dedup_key, event_id, event_type, tenant, order_id, channel, recipient_kind, recipient, template, message, status, max_attempts, sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $11 = 'SENT' THEN now() END)
           ON CONFLICT (dedup_key) DO NOTHING
           RETURNING id, created_at`,
          [
            dedupKey(event.id, i.ruleId, i.channel, i.recipient),
            event.id,
            event.type,
            event.tenant,
            event.aggregate.id,
            i.channel,
            i.recipientKind,
            i.recipient,
            i.template,
            JSON.stringify(i.message),
            status,
            isInApp ? 1 : (this.cfg.dispatch.maxAttempts[i.channel] ?? 5),
          ],
        );
        const row = res.rows?.[0];
        if (!res.rowCount) continue;
        if (isInApp && row) {
          const extra = (i.message.body ?? {}) as { severity?: 'info' | 'warning'; orderNumber?: number };
          live.push({
            recipient: i.recipient,
            item: {
              id: row.id,
              orderId: event.aggregate.id,
              orderNumber: extra.orderNumber ?? null,
              eventType: event.type,
              title: i.message.subject ?? '',
              body: i.message.text ?? '',
              severity: extra.severity ?? 'info',
              createdAt: new Date(row.created_at).toISOString(),
              readAt: null,
            },
          });
        }
        if (isSuppressed) suppressed++;
        else created++;
      }
      return { duplicate: false as const, created, suppressed };
    });

    // Depois do COMMIT: o aviso em tempo real só existe se a notificação existe.
    await Promise.all(live.map((l) => this.bus.publish(l.recipient, l.item)));
    return result;
  }
}
