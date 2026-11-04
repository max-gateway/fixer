import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CallerContext } from '../catalog-platform/catalog-platform.service.js';
import { PartCatalogLinkService } from '../catalog-platform/part-catalog-link.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoicesService } from './invoices.service.js';

export interface CatalogMatchReport {
  /** Itens que ficaram ligados a uma peça do catálogo agora. */
  resolved: number;
  /** Desses, quantos geraram uma peça nova na oficina (o resto ligou a uma peça que já existia). */
  created: number;
  /** Itens que continuam sem peça: o catálogo não os identifica de forma inequívoca, e a pessoa decide. */
  unresolved: number;
}

const normUnit = (u: string | null | undefined) => (u ?? '').trim().toUpperCase();

/**
 * Casamento da nota com o catálogo global (docs/specs/parts-search-integration.md §9): cada item sem peça é identificado no catálogo (GTIN, depois o código
 * do fabricante da descrição) e vira uma peça da oficina JÁ vinculada a ele. Assim o estoque que o lançamento movimenta é sempre o de uma peça que a busca
 * enxerga. É idempotente e só olha itens `UNRESOLVED`: o que a pessoa decidiu nunca é tocado. Roda com o token de quem abre a nota (fluxo de usuário).
 */
@Injectable()
export class CatalogMatchService {
  private readonly log = new Logger(CatalogMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: PartCatalogLinkService,
    private readonly invoices: InvoicesService,
  ) {}

  async matchInvoice(caller: CallerContext, catalog: string, invoiceId: string): Promise<CatalogMatchReport> {
    const invoice = await this.prisma.purchaseInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, status: true, exportStatus: true } });
    if (!invoice) throw new NotFoundException('Nota não encontrada');
    const none: CatalogMatchReport = { resolved: 0, created: 0, unresolved: 0 };
    if (invoice.status !== 'FULL' || !['PENDING_MATCH', 'READY'].includes(invoice.exportStatus)) return none;

    const open = await this.prisma.purchaseInvoiceItem.findMany({
      where: { invoiceId, resolution: 'UNRESOLVED' },
      orderBy: { itemNumber: 'asc' },
      select: { id: true, itemNumber: true, ean: true, description: true, unit: true },
    });
    if (open.length === 0) return none;

    const candidates = await this.links.candidatesForItems(caller, catalog, open);
    const skus = [...new Set([...candidates.values()].map((c) => c.catalogSku))];
    if (skus.length === 0) return { ...none, unresolved: open.length };

    const { items: live } = await this.links.lookupLive(caller, catalog, skus);
    const existing = await this.prisma.part.findMany({ where: { catalogSku: { in: skus } }, select: { id: true, catalogSku: true, unit: true } });
    const partBySku = new Map(existing.map((p) => [p.catalogSku!, p]));

    let resolved = 0;
    let created = 0;
    // Dois itens da mesma nota para a mesma peça do catálogo: o primeiro cria a peça, o segundo liga à que acabou de nascer (`partBySku`).
    for (const item of open) {
      const cand = candidates.get(item.id);
      const ref = cand && live.get(cand.catalogSku);
      if (!cand || !ref) continue;
      try {
        const part = partBySku.get(cand.catalogSku);
        if (part) {
          // Unidade diferente (nota em caixa, estoque em unidade) exige fator: fica para a pessoa.
          if (part.unit && normUnit(part.unit) !== normUnit(item.unit)) continue;
          await this.invoices.linkItemFromCatalog(invoiceId, item.itemNumber, part.id);
        } else {
          await this.invoices.createPartFromItem(invoiceId, item.itemNumber, { sellPrice: 0, unitFactor: 1, saveMapping: true, catalogSku: ref.sku }, ref, 'AUTO_CATALOG');
          created++;
          const made = await this.prisma.part.findFirst({ where: { catalogSku: ref.sku }, select: { id: true, catalogSku: true, unit: true } });
          if (made) partBySku.set(ref.sku, made);
        }
        resolved++;
      } catch (err) {
        // Um item que não casa (conflito de SKU, custo sem quantidade) não derruba os outros: segue para a pessoa.
        this.log.warn(`Item ${item.itemNumber} da nota ${invoiceId} não casou no catálogo: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { resolved, created, unresolved: open.length - resolved };
  }
}
