import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { Database } from '../db/database.service.js';

/** Métricas Prometheus. A profundidade da fila é lida do banco no momento do scrape (fonte da verdade). */
@Injectable()
export class Metrics {
  readonly registry = new Registry();

  readonly attempts = new Counter({
    name: 'whatsapp_send_attempts_total',
    help: 'Tentativas de envio por resultado (sent|retry|dead|suppressed).',
    labelNames: ['result'],
    registers: [this.registry],
  });
  readonly sendDuration = new Histogram({
    name: 'whatsapp_send_duration_seconds',
    help: 'Duração da chamada ao provedor.',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  readonly breakerState = new Gauge({
    name: 'whatsapp_circuit_breaker_state',
    help: 'Circuito do provedor: 0=fechado, 1=meio-aberto, 2=aberto.',
    registers: [this.registry],
  });
  readonly webhooks = new Counter({
    name: 'whatsapp_webhook_events_total',
    help: 'Eventos de webhook por tipo e resultado (processed|duplicate|ignored|invalid_signature).',
    labelNames: ['kind', 'result'],
    registers: [this.registry],
  });
  readonly orderCodes = new Counter({
    name: 'whatsapp_order_codes_total',
    help: 'Mensagens com código de OS por resultado (enqueued|rate_limited).',
    labelNames: ['result'],
    registers: [this.registry],
  });
  readonly eventBacklog = new Gauge({
    name: 'whatsapp_event_outbox_pending',
    help: 'Eventos no outbox ainda não publicados (alerte se crescer: relay parado ou Redis fora).',
    registers: [this.registry],
    collect: async () => {
      const { rows } = await this.db.query<{ n: string }>(
        'SELECT count(*) AS n FROM event_outbox WHERE published_at IS NULL',
      );
      this.eventBacklog.set(Number(rows[0]?.n ?? 0));
    },
  });
  readonly queueDepth = new Gauge({
    name: 'whatsapp_queue_depth',
    help: 'Mensagens por status.',
    labelNames: ['status'],
    registers: [this.registry],
    collect: async () => {
      this.queueDepth.reset();
      const { rows } = await this.db.query<{ status: string; n: string }>(
        'SELECT status, count(*) AS n FROM messages GROUP BY status',
      );
      for (const r of rows)
        this.queueDepth.set({ status: r.status }, Number(r.n));
    },
  });
  readonly oldestDueSeconds = new Gauge({
    name: 'whatsapp_oldest_due_age_seconds',
    help: 'Idade da mensagem enfileirada mais antiga já vencida (lag de entrega; alerte se crescer).',
    registers: [this.registry],
    collect: async () => {
      const { rows } = await this.db.query<{ age: number | null }>(
        `SELECT EXTRACT(EPOCH FROM now() - min(next_attempt_at))::float AS age
           FROM messages WHERE status = 'QUEUED' AND next_attempt_at <= now()`,
      );
      this.oldestDueSeconds.set(rows[0]?.age ?? 0);
    },
  });

  constructor(private readonly db: Database) {
    collectDefaultMetrics({ register: this.registry });
  }
}
