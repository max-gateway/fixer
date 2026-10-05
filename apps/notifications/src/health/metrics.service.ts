import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { Database } from '../db/database.service.js';

/** Métricas Prometheus. A profundidade da fila é lida do banco no momento do scrape (fonte da verdade). */
@Injectable()
export class Metrics {
  readonly registry = new Registry();

  readonly eventsConsumed = new Counter({
    name: 'notifications_events_consumed_total',
    help: 'Eventos lidos do stream, por resultado (processed|duplicate|dead_lettered).',
    labelNames: ['type', 'result'],
    registers: [this.registry],
  });
  readonly sent = new Counter({
    name: 'notifications_delivery_attempts_total',
    help: 'Tentativas de entrega por canal e resultado (sent|retry|dead).',
    labelNames: ['channel', 'result'],
    registers: [this.registry],
  });
  readonly sendDuration = new Histogram({
    name: 'notifications_send_duration_seconds',
    help: 'Duração do envio no provedor.',
    labelNames: ['channel'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20],
    registers: [this.registry],
  });
  readonly breakerState = new Gauge({
    name: 'notifications_circuit_breaker_state',
    help: 'Circuito por canal: 0=fechado, 1=meio-aberto, 2=aberto.',
    labelNames: ['channel'],
    registers: [this.registry],
  });
  readonly queueDepth = new Gauge({
    name: 'notifications_queue_depth',
    help: 'Notificações por status.',
    labelNames: ['status'],
    registers: [this.registry],
    collect: async () => {
      this.queueDepth.reset();
      const { rows } = await this.db.query<{ status: string; n: string }>(
        'SELECT status, count(*) AS n FROM notifications GROUP BY status',
      );
      for (const r of rows) this.queueDepth.set({ status: r.status }, Number(r.n));
    },
  });
  readonly oldestDueSeconds = new Gauge({
    name: 'notifications_oldest_due_age_seconds',
    help: 'Idade da notificação pendente mais antiga já vencida (lag de entrega; alerte se crescer).',
    registers: [this.registry],
    collect: async () => {
      const { rows } = await this.db.query<{ age: number | null }>(
        `SELECT EXTRACT(EPOCH FROM now() - min(next_attempt_at))::float AS age
           FROM notifications WHERE status = 'PENDING' AND next_attempt_at <= now()`,
      );
      this.oldestDueSeconds.set(rows[0]?.age ?? 0);
    },
  });

  constructor(private readonly db: Database) {
    collectDefaultMetrics({ register: this.registry });
  }
}
