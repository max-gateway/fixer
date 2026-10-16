import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { backfillInvoiceTax } from './backfill.js';

const FIRST_RUN_MS = 60_000;

/**
 * Uma passada, logo depois do boot, que preenche a captura tributária das notas antigas (docs/specs/pricing.md §4.0).
 * Idempotente e barata quando não há o que fazer (uma consulta por organização com nota completa). O cliente de sistema só
 * descobre ONDE agir; a gravação roda pelo PrismaService dentro de `TenantContext.run`, sob RLS.
 */
@Injectable()
export class InvoiceTaxBackfill implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InvoiceTaxBackfill.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly system: SystemPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (process.env.INVOICE_TAX_BACKFILL === 'off') return;
    this.timer = setTimeout(() => void this.runOnce(), FIRST_RUN_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Devolve quantas notas foram preenchidas, somando todas as organizações. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let updated = 0;
    try {
      const orgs = await this.system.purchaseInvoice.findMany({
        where: { status: 'FULL', xmlGz: { not: null }, items: { some: { tax: { is: null } } } },
        distinct: ['orgId'],
        select: { orgId: true },
      });
      for (const { orgId } of orgs) {
        try {
          const seen = new Set<string>();
          let failed = 0;
          for (;;) {
            const r = await TenantContext.run(orgId, () => backfillInvoiceTax(this.prisma, { skip: seen }));
            updated += r.updated;
            failed += r.failedIds.length;
            r.scannedIds.forEach((id) => seen.add(id));
            if (r.scanned === 0) break;
          }
          if (failed > 0) this.logger.warn(`Organização ${orgId}: ${failed} nota(s) com XML ilegível ficaram sem captura tributária`);
        } catch (err) {
          this.logger.warn(`Captura tributária da organização ${orgId} não concluída: ${(err as Error).message}`);
        }
      }
      if (updated > 0) this.logger.log(`Captura tributária preenchida em ${updated} nota(s) antiga(s)`);
    } finally {
      this.running = false;
    }
    return updated;
  }
}
