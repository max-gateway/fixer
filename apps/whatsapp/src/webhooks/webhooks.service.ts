import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../db/database.service.js';
import { EventOutbox, type EnqueueResult } from '../events/event-outbox.js';
import { extractOrderCode } from '../events/order-code.js';
import { Metrics } from '../health/metrics.service.js';
import {
  optIntent,
  type InboundMessage,
  type StatusUpdate,
  WebhookPayload,
} from './payload.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secondsToDate = (ts: string | undefined) =>
  ts ? new Date(Number(ts) * 1000) : new Date();

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: Database,
    private readonly metrics: Metrics,
    private readonly outbox: EventOutbox,
  ) {}

  /** Processa um payload já autenticado. Lança em falha de banco: a Meta reentrega (e o dedup protege). */
  async handle(body: unknown): Promise<void> {
    const parsed = WebhookPayload.safeParse(body);
    if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') {
      this.metrics.webhooks.inc({ kind: 'payload', result: 'ignored' });
      return;
    }
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        for (const s of change.value.statuses ?? []) await this.onStatus(s);
        for (const m of change.value.messages ?? []) await this.onInbound(m);
      }
    }
  }

  private async onStatus(s: StatusUpdate): Promise<void> {
    // O status pode chegar antes de o Dispatcher gravar o wamid (envio e webhook correm em paralelo).
    for (let attempt = 0; attempt < 4; attempt++) {
      const known = await this.db.query(
        'SELECT 1 FROM messages WHERE wamid = $1',
        [s.id],
      );
      if (known.rowCount) break;
      if (attempt === 3) {
        this.logger.warn(
          `Status para wamid desconhecido (${s.status}); ignorado`,
        );
        this.metrics.webhooks.inc({ kind: 'status', result: 'ignored' });
        return;
      }
      await sleep(500);
    }

    const processed = await this.db.tx(async (c) => {
      if (!(await this.firstTime(c, `${s.id}:${s.status}`))) return false;
      const at = secondsToDate(s.timestamp);
      switch (s.status) {
        case 'sent':
          await c.query(
            'UPDATE messages SET sent_at = COALESCE(sent_at, $2), updated_at = now() WHERE wamid = $1',
            [s.id, at],
          );
          break;
        case 'delivered':
          await c.query(
            `UPDATE messages SET delivered_at = LEAST(COALESCE(delivered_at, $2), $2), updated_at = now(),
                    status = CASE WHEN status IN ('SENDING','SENT') THEN 'DELIVERED' ELSE status END
              WHERE wamid = $1`,
            [s.id, at],
          );
          break;
        case 'read':
          // "read" pode chegar sem "delivered" (ordem não garantida): preenche os dois.
          await c.query(
            `UPDATE messages SET read_at = COALESCE(read_at, $2), delivered_at = LEAST(COALESCE(delivered_at, $2), $2), updated_at = now(),
                    status = CASE WHEN status IN ('SENDING','SENT','DELIVERED') THEN 'READ' ELSE status END
              WHERE wamid = $1`,
            [s.id, at],
          );
          break;
        case 'failed': {
          const err = s.errors?.[0];
          await c.query(
            `UPDATE messages SET last_error = $2, last_error_code = $3, updated_at = now(),
                    status = CASE WHEN status IN ('SENDING','SENT') THEN 'FAILED' ELSE status END
              WHERE wamid = $1`,
            [
              s.id,
              (err?.message ?? err?.title ?? 'falha reportada pela Meta').slice(
                0,
                1000,
              ),
              err?.code?.toString() ?? null,
            ],
          );
          break;
        }
        default:
          break;
      }
      return true;
    });
    this.metrics.webhooks.inc({
      kind: 'status',
      result: processed ? 'processed' : 'duplicate',
    });
  }

  private async onInbound(m: InboundMessage): Promise<void> {
    const text = m.text?.body ?? m.button?.text ?? null;
    const sentAt = secondsToDate(m.timestamp);
    const phone = m.from.replace(/\D/g, '');

    let codeResult: EnqueueResult | null = null;
    const processed = await this.db.tx(async (c) => {
      if (!(await this.firstTime(c, m.id))) return false;
      await c.query(
        `INSERT INTO inbound_messages (wamid, from_phone, type, body, sent_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [m.id, phone, m.type, text, sentAt],
      );
      // Quem escreve abre a janela de 24h e, se ainda não tinha preferência, conta como opt-in.
      const intent = optIntent(text ?? undefined);
      await c.query(
        `INSERT INTO contacts (phone, opt_status, opt_reason, last_inbound_at)
         VALUES ($1, COALESCE($2, 'OPTED_IN'), $3, $4)
         ON CONFLICT (phone) DO UPDATE SET
           last_inbound_at = GREATEST(contacts.last_inbound_at, $4),
           opt_status = CASE
             WHEN $2::text IS NOT NULL THEN $2
             WHEN contacts.opt_status = 'UNKNOWN' THEN 'OPTED_IN'
             ELSE contacts.opt_status END,
           opt_reason = CASE WHEN $2::text IS NOT NULL THEN $3 ELSE contacts.opt_reason END,
           updated_at = now()`,
        [
          phone,
          intent,
          intent ? 'palavra-chave do cliente' : 'cliente iniciou conversa',
          sentAt,
        ],
      );
      // Mensagem com código de OS (vem do botão do portal): vira evento, na mesma transação.
      // Este serviço NÃO decide nada sobre a ordem: quem vincula é a API, dona do dado.
      const code = extractOrderCode(text);
      if (code) {
        codeResult = await this.outbox.enqueueOrderCode(c, {
          wamid: m.id,
          from: phone,
          code,
          sentAt,
        });
      }
      return true;
    });
    if (codeResult) this.metrics.orderCodes.inc({ result: codeResult });
    this.metrics.webhooks.inc({
      kind: 'inbound',
      result: processed ? 'processed' : 'duplicate',
    });
  }

  private async firstTime(c: PoolClient, id: string): Promise<boolean> {
    const r = await c.query(
      'INSERT INTO webhook_events (id) VALUES ($1) ON CONFLICT DO NOTHING',
      [id],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
