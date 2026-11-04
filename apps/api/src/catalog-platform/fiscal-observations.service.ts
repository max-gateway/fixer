import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogPlatformService, type CallerContext, type FiscalObservationItem } from './catalog-platform.service.js';
import { PartsSearchConfig } from './parts-search.config.js';

/** Itens por chamada à plataforma (o teto dela). */
export const OBSERVATIONS_PER_CALL = 500;

interface InvoiceForObservation {
  accessKey: string;
  issuerCnpj: string;
  issuedAt: Date | null;
  postedAt: Date | null;
  items: Array<{ ncm: string; cest: string | null; origin: number | null; unit: string; part: { catalogSku: string | null } | null }>;
}

/**
 * Evidência fiscal das notas de entrada (docs/specs/parts-search-fiscal.md §6 e §9): ao lançar uma nota, o que o fornecedor escreveu (NCM, CEST, origem,
 * unidade) para cada peça JÁ VINCULADA ao catálogo vai à plataforma, que conta emitentes distintos e propõe consenso ao curador. É só evidência: nunca
 * altera a classificação em vigor, nem a da oficina nem a do catálogo.
 *
 * Melhor esforço: o lançamento da nota NUNCA falha nem espera por isto. Perder uma observação só atrasa um consenso (a próxima nota do fornecedor a refaz), e
 * a plataforma é idempotente por (nota, peça), então repetir é seguro.
 */
@Injectable()
export class FiscalObservationsService {
  private readonly logger = new Logger(FiscalObservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: CatalogPlatformService,
    @Optional() private readonly config?: PartsSearchConfig,
  ) {}

  /** Monta as observações da nota. Função pura sobre o que o banco devolveu (testável sem plataforma). */
  static itemsOf(inv: InvoiceForObservation): FiscalObservationItem[] {
    // CPF (produtor rural, 11 dígitos) não é emitente com CNPJ: a plataforma exige 14 posições.
    const issuerCnpj = inv.issuerCnpj.replace(/[.\-/\s]/g, '').toUpperCase();
    if (!/^[0-9A-Z]{14}$/.test(issuerCnpj)) return [];
    const observedAt = (inv.issuedAt ?? inv.postedAt ?? new Date()).toISOString();
    const seen = new Set<string>();
    const out: FiscalObservationItem[] = [];
    for (const it of inv.items) {
      const sku = it.part?.catalogSku;
      const ncm = it.ncm.replace(/[.\s]/g, '');
      // Duas linhas da nota para a mesma peça do catálogo valem uma observação (a plataforma também deduplica por nota e peça).
      if (!sku || seen.has(sku) || !/^[0-9]{8}$/.test(ncm)) continue;
      seen.add(sku);
      const cest = it.cest?.replace(/[.\s]/g, '');
      const unit = it.unit.trim().toUpperCase();
      out.push({
        sku,
        accessKey: inv.accessKey,
        issuerCnpj,
        observedAt,
        source: 'NFE_XML',
        ncm,
        ...(cest && /^[0-9]{7}$/.test(cest) ? { cest } : {}),
        ...(it.origin !== null && Number.isInteger(it.origin) && it.origin >= 0 && it.origin <= 8 ? { origin: it.origin } : {}),
        ...(/^[A-Z0-9]{1,6}$/.test(unit) ? { unit } : {}),
      });
    }
    return out;
  }

  /** Envia as observações da nota. Lança se a plataforma falhar (quem chama em segundo plano decide o que fazer). */
  async emit(caller: CallerContext, invoiceId: string): Promise<{ sent: number }> {
    const inv = await this.prisma.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        accessKey: true,
        issuerCnpj: true,
        issuedAt: true,
        postedAt: true,
        items: { where: { partId: { not: null } }, orderBy: { itemNumber: 'asc' }, select: { ncm: true, cest: true, origin: true, unit: true, part: { select: { catalogSku: true } } } },
      },
    });
    if (!inv) return { sent: 0 };
    const items = FiscalObservationsService.itemsOf(inv);
    for (let i = 0, n = 0; i < items.length; i += OBSERVATIONS_PER_CALL, n++) {
      await this.platform.fiscalObservations(caller, items.slice(i, i + OBSERVATIONS_PER_CALL), `fixer-invoice-${invoiceId}-${n}`);
    }
    return { sent: items.length };
  }

  /**
   * Dispara sem esperar e sem nunca lançar: o lançamento da nota já está commitado. `caller` é uma função porque montá-lo também pode falhar
   * (sem token, sem organização) e isso não pode derrubar a resposta. Sem `PARTS_SEARCH_URL` não há para quem enviar.
   */
  emitInBackground(caller: () => CallerContext, invoiceId: string): void {
    if (this.config && !this.config.baseUrl) return;
    void Promise.resolve()
      .then(() => this.emit(caller(), invoiceId))
      .catch((err: unknown) => this.logger.warn(`observações fiscais da nota ${invoiceId} não enviadas: ${err instanceof Error ? err.message : String(err)}`));
  }
}
