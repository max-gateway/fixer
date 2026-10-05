import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { CONFIG, type AppConfig } from '../config/config.js';

/**
 * Contrato v1 do evento publicado no stream. É o ÚNICO acoplamento com quem consome (apps/api):
 * o consumidor mantém a própria cópia do schema e nunca lê as tabelas deste serviço.
 * Mudança incompatível => nova `version`; nunca editar campos do v1.
 */
export interface OrderCodeReceivedEvent {
  id: string;
  type: 'whatsapp.order_code_received';
  version: 1;
  occurredAt: string;
  tenant: string;
  source: 'whatsapp';
  data: {
    wamid: string;
    /** E.164 sem "+", exatamente como a Meta entregou (já verificado pelo WhatsApp). */
    from: string;
    code: string;
    sentAt: string;
  };
}

export type EnqueueResult = 'enqueued' | 'rate_limited';

@Injectable()
export class EventOutbox {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  /**
   * Grava o evento usando a transação do chamador (atomicidade com a mensagem recebida).
   * Limite por remetente: quem tenta adivinhar códigos em massa para de gerar eventos; a mensagem
   * continua registrada em `inbound_messages`, só não vira tentativa de vínculo.
   */
  async enqueueOrderCode(
    c: PoolClient,
    input: { wamid: string; from: string; code: string; sentAt: Date },
  ): Promise<EnqueueResult> {
    const { max, windowMs } = this.cfg.events.codeRateLimit;
    const recent = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM event_outbox
        WHERE subject = $1 AND created_at > now() - ($2 || ' milliseconds')::interval`,
      [input.from, String(windowMs)],
    );
    if (Number(recent.rows[0]?.n ?? 0) >= max) return 'rate_limited';

    const event: OrderCodeReceivedEvent = {
      id: randomUUID(),
      type: 'whatsapp.order_code_received',
      version: 1,
      occurredAt: new Date().toISOString(),
      tenant: this.cfg.events.tenant,
      source: 'whatsapp',
      data: {
        wamid: input.wamid,
        from: input.from,
        code: input.code,
        sentAt: input.sentAt.toISOString(),
      },
    };
    await c.query(
      'INSERT INTO event_outbox (id, type, subject, payload) VALUES ($1,$2,$3,$4)',
      [event.id, event.type, input.from, JSON.stringify(event)],
    );
    return 'enqueued';
  }
}
