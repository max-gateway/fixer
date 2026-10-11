import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { Database } from '../db/database.service.js';

/** Métricas Prometheus (docs/specs/dfe-gateway.md §11.1). Filas e atrasos são lidos do banco no scrape. */
@Injectable()
export class Metrics {
  readonly registry = new Registry();

  readonly sefazRequests = new Counter({
    name: 'dfe_sefaz_requests_total',
    help: 'Respostas da SEFAZ por cStat (0 = falha de transporte).',
    labelNames: ['op', 'cstat'],
    registers: [this.registry],
  });
  readonly sefazLatency = new Histogram({
    name: 'dfe_sefaz_latency_seconds',
    help: 'Duração da chamada à SEFAZ.',
    labelNames: ['op'],
    buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 40, 60],
    registers: [this.registry],
  });
  readonly documents = new Counter({
    name: 'dfe_documents_ingested_total',
    help: 'Documentos gravados, por resultado (stored|duplicate|invalid).',
    labelNames: ['result'],
    registers: [this.registry],
  });
  readonly deliveries = new Counter({
    name: 'dfe_delivery_attempts_total',
    help: 'Tentativas de entrega por transporte e resultado (sent|retry|dead).',
    labelNames: ['transport', 'result'],
    registers: [this.registry],
  });
  readonly leaseLost = new Counter({
    name: 'dfe_lease_lost_total',
    help: 'Rodadas abortadas porque o lease do CNPJ foi perdido.',
    registers: [this.registry],
  });

  readonly syncLag = new Gauge({
    name: 'dfe_sync_lag_seconds',
    help: 'Maior atraso (agora − último sucesso) entre os CNPJs habilitados.',
    registers: [this.registry],
    collect: async () => {
      const { rows } = await this.db.query<{ lag: number | null }>(
        `SELECT EXTRACT(EPOCH FROM now() - min(COALESCE(s.last_success_at, c.updated_at)))::float AS lag
           FROM sync_state s JOIN credentials c ON c.company_id = s.company_id WHERE c.enabled`,
      );
      this.syncLag.set(rows[0]?.lag ?? 0);
    },
  });
  readonly blocked = new Gauge({
    name: 'dfe_blocked_companies',
    help: 'CNPJs cujo último retorno foi 656 (consumo indevido).',
    registers: [this.registry],
    collect: async () => {
      const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM sync_state WHERE last_status_code = 656');
      this.blocked.set(Number(rows[0]?.n ?? 0));
    },
  });
  readonly deliveryPending = new Gauge({
    name: 'dfe_delivery_pending',
    help: 'Entregas por estado.',
    labelNames: ['state'],
    registers: [this.registry],
    collect: async () => {
      this.deliveryPending.reset();
      const { rows } = await this.db.query<{ state: string; n: string }>('SELECT state, count(*) AS n FROM deliveries GROUP BY state');
      for (const r of rows) this.deliveryPending.set({ state: r.state }, Number(r.n));
    },
  });
  readonly credentialExpiring = new Gauge({
    name: 'dfe_credential_expiring',
    help: 'Certificados habilitados que vencem em até N dias.',
    labelNames: ['days'],
    registers: [this.registry],
    collect: async () => {
      for (const days of [30, 15, 7]) {
        const { rows } = await this.db.query<{ n: string }>(
          `SELECT count(*) AS n FROM credentials WHERE enabled AND not_after < now() + make_interval(days => $1)`,
          [days],
        );
        this.credentialExpiring.set({ days: String(days) }, Number(rows[0]?.n ?? 0));
      }
    },
  });

  constructor(private readonly db: Database) {
    collectDefaultMetrics({ register: this.registry });
  }
}
