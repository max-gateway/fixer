import { hostname } from 'node:os';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantDirectory } from '../../tenancy/tenant-directory.service.js';
import type { DistDocument } from '../parser/dist-response.parser.js';
import { processBatch, type BatchCounters } from '../sync/batch.processor.js';
import { GatewayClient, GatewayError, type GatewayDocument } from './gateway.client.js';
import { GATEWAY_CONFIG, type GatewayConfig } from './gateway.config.js';

const LEASE_MS = 2 * 60_000;
/** Teto de páginas (50 docs) por tick: backlog grande não prende o lease por horas. */
const MAX_PAGES_PER_TICK = 100;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Documento do gateway → o formato que o `processBatch` já entende (o mesmo da SEFAZ direta). */
export function toDistDocument(d: GatewayDocument): DistDocument {
  return { nsu: BigInt(d.nsu), schema: d.schema, xml: d.xml };
}

/**
 * Consumidor do `dfe-gateway` (docs/specs/dfe-gateway.md §7.3): puxa por cursor de NSU, grava o lote com o MESMO
 * `processBatch` do modo direto (idempotente) e só então confirma (`ack`). Não depende de aviso: o reconciliador
 * roda a cada `pollMs`, então um webhook perdido ou o gateway fora do ar só atrasam, nunca perdem nota.
 *
 * Várias réplicas da API: o lease em `FiscalSyncState` deixa uma só consumir por vez.
 */
@Injectable()
export class GatewayConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(GatewayConsumer.name);
  private readonly owner = `${hostname()}-${process.pid}`;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(GatewayClient) private readonly gateway: GatewayClient | null,
    @Optional() @Inject(GATEWAY_CONFIG) private readonly cfg: GatewayConfig | null,
    /** Descobre as organizações com certificado habilitado. Sem ele (testes), o ciclo roda na organização do contexto. */
    @Optional() @Inject(TenantDirectory) private readonly directory: TenantDirectory | null = null,
  ) {}

  onModuleInit(): void {
    if (!this.gateway || !this.cfg) return;
    this.running = true;
    this.loop = this.run();
    this.logger.log(`Consumindo o dfe-gateway como ${this.owner} (a cada ${this.cfg.pollMs} ms).`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.tickAll();
      } catch (err) {
        // Gateway fora do ar ou erro de banco: tenta de novo no próximo ciclo; o cursor não andou.
        this.logger.warn(`Ciclo do gateway falhou: ${(err as Error).message}`);
      }
      await sleep(this.cfg!.pollMs);
    }
  }

  /** Um ciclo por organização com certificado habilitado; a falha de uma não atrapalha as outras. */
  async tickAll(now: Date = new Date()): Promise<void> {
    if (!this.directory) return void (await this.tick(now));
    for (const orgId of await this.directory.orgsWithFiscalCredential()) {
      if (!this.running) return;
      try {
        await TenantContext.run(orgId, () => this.tick(now));
      } catch (err) {
        this.logger.warn(`Ciclo do gateway da organização ${orgId} falhou: ${(err as Error).message}`);
      }
    }
  }

  /** Um ciclo DA ORGANIZAÇÃO DO CONTEXTO: conquista o lease, puxa e grava os documentos novos, espelha o estado do gateway. */
  async tick(now: Date = new Date()): Promise<{ pulled: number; counters: BatchCounters[] } | null> {
    const cred = await this.prisma.fiscalCredential.findUnique({ where: { orgId: TenantContext.require() }, select: { enabled: true } });
    const settings = await this.prisma.tenantFiscalSettings.findUnique({ where: { orgId: TenantContext.require() }, select: { cnpj: true } });
    if (!cred || !settings?.cnpj) return null; // sem certificado cadastrado: nada a consumir
    if (!(await this.acquire(now))) return null;
    try {
      return await this.consume(settings.cnpj, now);
    } finally {
      await this.release();
    }
  }

  private async consume(cnpj: string, now: Date) {
    const gateway = this.gateway!;
    const counters: BatchCounters[] = [];
    let pulled = 0;

    try {
      for (let i = 0; i < MAX_PAGES_PER_TICK; i++) {
        const state = await this.prisma.fiscalSyncState.findUniqueOrThrow({ where: { orgId: TenantContext.require() }, select: { lastNsu: true } });
        const page = await gateway.listDocuments(cnpj, state.lastNsu.toString());
        if (page.items.length > 0) {
          const docs = page.items.map(toDistDocument);
          const top = docs.reduce((m, d) => (d.nsu !== null && d.nsu > m ? d.nsu : m), 0n);
          // O lote e o NSU na MESMA transação: se o banco falhar, nada foi gravado e a página volta no próximo ciclo.
          const batch = await this.prisma.$transaction(async (tx) => {
            const c = await processBatch(tx, docs, { tenantCnpj: cnpj, now });
            await tx.fiscalSyncState.updateMany({ where: { orgId: TenantContext.require(), lastNsu: { lte: top } }, data: { lastNsu: top } });
            return c;
          }, TX_OPTIONS);
          counters.push(batch);
          pulled += docs.length;
          await gateway.ack(cnpj, top.toString()); // só depois do COMMIT
          await this.renew();
        }
        if (!page.nextCursor) break;
      }
      await this.mirrorStatus(cnpj);
      await this.markManifested(cnpj, now);
    } catch (err) {
      if (err instanceof GatewayError) {
        this.logger.warn(`dfe-gateway: ${err.message} (HTTP ${err.status})`);
        return { pulled, counters };
      }
      throw err;
    }
    if (pulled > 0) this.logger.log(`dfe-gateway: ${pulled} documento(s) importado(s) ${JSON.stringify(counters)}`);
    return { pulled, counters };
  }

  /** Espelha o que o gateway sabe da SEFAZ (cStat, próximo poll, erro, flags, validade) para a tela de configuração. */
  private async mirrorStatus(cnpj: string): Promise<void> {
    const gw = await this.gateway!.getCompany(cnpj);
    const s = gw.sync;
    if (s) {
      await this.prisma.fiscalSyncState.update({
        where: { orgId: TenantContext.require() },
        data: {
          maxNsu: BigInt(s.max_nsu),
          nextPollAt: new Date(s.next_poll_at),
          lastStatusCode: s.last_status_code,
          lastError: s.last_error,
          lastRunAt: s.last_run_at ? new Date(s.last_run_at) : null,
          lastSuccessAt: s.last_success_at ? new Date(s.last_success_at) : null,
          consecutiveFailures: s.consecutive_failures,
        },
      });
    }
    if (gw.credential) {
      await this.prisma.fiscalCredential.update({
        where: { orgId: TenantContext.require() },
        data: { enabled: gw.credential.enabled, autoManifest: gw.credential.auto_manifest, notAfter: new Date(gw.credential.not_after) },
      });
    }
  }

  /** Chaves cuja ciência o gateway já registrou: a nota local deixa de ser `SUMMARY` e passa a aguardar o XML. */
  private async markManifested(cnpj: string, now: Date): Promise<void> {
    const { items } = await this.gateway!.registeredManifestations(cnpj);
    if (items.length === 0) return;
    await this.prisma.purchaseInvoice.updateMany({
      where: { accessKey: { in: items.map((m) => m.accessKey) }, status: 'SUMMARY' },
      data: { status: 'MANIFESTED', manifestedAt: now, manifestError: null, manifestNextAt: null },
    });
  }

  private async acquire(now: Date): Promise<boolean> {
    const { count } = await this.prisma.fiscalSyncState.updateMany({
      where: { orgId: TenantContext.require(), OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + LEASE_MS), leaseOwner: this.owner },
    });
    return count > 0;
  }

  private async renew(): Promise<void> {
    await this.prisma.fiscalSyncState.updateMany({ where: { orgId: TenantContext.require(), leaseOwner: this.owner }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } });
  }

  private async release(): Promise<void> {
    await this.prisma.fiscalSyncState.updateMany({ where: { orgId: TenantContext.require(), leaseOwner: this.owner }, data: { leaseUntil: null, leaseOwner: null } });
  }
}
