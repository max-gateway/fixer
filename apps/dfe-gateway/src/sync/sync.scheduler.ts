import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { KEY_PROVIDER } from '../credentials/credential.service.js';
import type { KeyProvider } from '../core/crypto/key-provider.js';
import { Database } from '../db/database.service.js';
import { Metrics } from '../health/metrics.service.js';
import { SyncRunner } from './sync.runner.js';

/** Mantido em sincronia com o `interval '5 minutes'` do UPDATE em `acquire`. */
const LEASE_MS = 5 * 60_000;
/** Teto de lotes por CNPJ por tick (50 docs cada): um backlog gigante não monopoliza o lease. */
const MAX_BATCHES_PER_TICK = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Loop em processo. A cada tick, este worker conquista, com UM UPDATE atômico (`FOR UPDATE SKIP LOCKED`), o
 * lease de até N CNPJs vencidos e os sincroniza em paralelo. Vários workers disputam sem coordenação extra e
 * nenhum processa o mesmo CNPJ ao mesmo tempo (docs/specs/dfe-gateway.md §8.1). Worker que cai deixa o lease
 * expirar (5 min) e outro assume; tudo é idempotente.
 */
@Injectable()
export class SyncScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SyncScheduler.name);
  private running = false;
  private stopping = false;
  private loop: Promise<void> | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly runner: SyncRunner,
    private readonly metrics: Metrics,
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.runWorker) return;
    if (!this.keys.available) return this.logger.warn('Sem DFE_ENC_KEYS: sincronização indisponível.');
    this.running = true;
    this.loop = this.run();
    this.logger.log(`Sincronização ativa como ${this.config.owner} (tick ${this.config.tickMs} ms, ${this.config.concurrency} CNPJs em paralelo).`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.stopping = true;
    await this.loop;
    await Promise.allSettled(this.inFlight);
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error('Falha no ciclo da sincronização', err as Error);
      }
      await sleep(this.config.tickMs);
    }
  }

  /** Um tick: conquista os CNPJs vencidos que cabem na concorrência e sincroniza cada um até a fila esgotar. */
  async tick(): Promise<void> {
    const room = this.config.concurrency - this.inFlight.size;
    if (room <= 0 || this.stopping) return;
    const ids = await this.acquire(room);
    for (const id of ids) {
      const p = this.syncCompany(id).finally(() => this.inFlight.delete(p));
      this.inFlight.add(p);
    }
    await Promise.allSettled(this.inFlight);
  }

  private async syncCompany(companyId: string): Promise<void> {
    try {
      for (let i = 0; i < MAX_BATCHES_PER_TICK && !this.stopping; i++) {
        const { outcome } = await this.runner.runOnce(companyId);
        if (outcome !== 'MORE') return;
        if (!(await this.renew(companyId))) {
          this.metrics.leaseLost.inc();
          return; // perdeu o lease (processo parado por muito tempo): sai sem gravar mais nada
        }
      }
    } catch (err) {
      this.logger.error(`Rodada de ${companyId} falhou: ${(err as Error).message}`);
    } finally {
      await this.release(companyId).catch(() => undefined);
    }
  }

  private async acquire(limit: number): Promise<string[]> {
    const { rows } = await this.db.query<{ company_id: string }>(
      `WITH due AS (
         SELECT s.company_id FROM sync_state s
           JOIN credentials c ON c.company_id = s.company_id
          WHERE c.enabled AND c.status = 'ACTIVE'
            AND s.next_poll_at <= now()
            AND (s.lease_until IS NULL OR s.lease_until < now())
          ORDER BY s.next_poll_at
          LIMIT $2
          FOR UPDATE OF s SKIP LOCKED)
       UPDATE sync_state s
          SET lease_until = now() + interval '5 minutes', lease_owner = $1
         FROM due WHERE s.company_id = due.company_id
       RETURNING s.company_id`,
      [this.config.owner, limit],
    );
    return rows.map((r) => r.company_id);
  }

  private async renew(companyId: string): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE sync_state SET lease_until = $3 WHERE company_id = $1 AND lease_owner = $2', [
      companyId,
      this.config.owner,
      new Date(Date.now() + LEASE_MS),
    ]);
    return (rowCount ?? 0) > 0;
  }

  private async release(companyId: string): Promise<void> {
    await this.db.query('UPDATE sync_state SET lease_until = NULL, lease_owner = NULL WHERE company_id = $1 AND lease_owner = $2', [companyId, this.config.owner]);
  }
}
