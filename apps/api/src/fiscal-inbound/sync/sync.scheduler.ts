import { hostname } from 'node:os';
import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KEY_PROVIDER } from '../credentials/credential.service.js';
import type { KeyProvider } from '../crypto/key-provider.js';
import { FISCAL_CONFIG, type FiscalConfig } from '../fiscal.config.js';
import { GatewayClient } from '../gateway/gateway.client.js';
import { SyncRunner } from './sync.runner.js';

/** Mantido em sincronia com o `interval '5 minutes'` do UPDATE em `acquireLease`. */
const LEASE_MS = 5 * 60_000;
/** Teto de lotes por tick (50 docs cada): impede uma réplica de monopolizar o lease num backlog gigante. */
const MAX_BATCHES_PER_TICK = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Loop em processo (padrão do OutboxRelay). A cada tick, uma réplica conquista o lease da linha
 * `FiscalSyncState` com um UPDATE atômico e roda; as outras não fazem nada. Lease em tabela, e não
 * advisory lock, porque a chamada à SEFAZ é longa e não deve segurar transação do Postgres.
 * Réplica que cai deixa o lease expirar (5 min) e outra assume; tudo é idempotente.
 */
@Injectable()
export class SyncScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SyncScheduler.name);
  private readonly owner = `${hostname()}-${process.pid}`;
  private running = false;
  private stopping = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: SyncRunner,
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
    @Inject(FISCAL_CONFIG) private readonly config: FiscalConfig,
    @Optional() @Inject(GatewayClient) private readonly gateway: GatewayClient | null = null,
  ) {}

  onModuleInit(): void {
    if (this.gateway) return this.logger.log('Modo gateway: a SEFAZ é consultada pelo dfe-gateway; o consumo é do GatewayConsumer.');
    if (!this.config.syncEnabled) return this.logger.log('Sincronização fiscal desligada (FISCAL_SYNC_ENABLED=false).');
    if (!this.keys.available) return this.logger.warn('Sem FISCAL_ENC_KEYS: sincronização fiscal indisponível.');
    this.running = true;
    this.loop = this.run();
    this.logger.log(`Sincronização fiscal ativa como ${this.owner} (tick ${this.config.tickMs} ms).`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.stopping = true;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error('Falha no ciclo da sincronização fiscal', err as Error);
      }
      await sleep(this.config.tickMs);
    }
  }

  /** Um tick: tenta o lease e, se conquistou, roda até a fila esgotar ou algo mandar esperar. */
  async tick(): Promise<void> {
    if (!(await this.acquireLease())) return;
    try {
      for (let i = 0; i < MAX_BATCHES_PER_TICK && !this.stopping; i++) {
        const { outcome } = await this.runner.runOnce();
        if (outcome !== 'MORE') return;
        if (!(await this.renewLease())) return; // perdeu o lease (processo parado por muito tempo): sai sem gravar mais nada
      }
    } finally {
      await this.releaseLease();
    }
  }

  private async acquireLease(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      UPDATE "FiscalSyncState" AS s
      SET "leaseUntil" = now() + interval '5 minutes', "leaseOwner" = ${this.owner}
      FROM "FiscalCredential" AS c
      WHERE c."id" = s."id" AND c."enabled" = true
        AND s."nextPollAt" <= now()
        AND (s."leaseUntil" IS NULL OR s."leaseUntil" < now())
      RETURNING s."id"`;
    return rows.length > 0;
  }

  private async renewLease(): Promise<boolean> {
    const { count } = await this.prisma.fiscalSyncState.updateMany({
      where: { id: 1, leaseOwner: this.owner },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    return count > 0;
  }

  private async releaseLease(): Promise<void> {
    await this.prisma.fiscalSyncState.updateMany({
      where: { id: 1, leaseOwner: this.owner },
      data: { leaseUntil: null, leaseOwner: null },
    });
  }
}
