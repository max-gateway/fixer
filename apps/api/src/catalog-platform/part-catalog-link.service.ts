import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { classifyBarcodeLinks, type LinkVerdict } from './catalog-link.js';
import { CatalogPlatformService, type CallerContext } from './catalog-platform.service.js';

/** Peças examinadas por chamada do vínculo em lote, e quantos vereditos o relatório devolve (o resto vem só nos totais). */
const LINK_BATCH_LIMIT = 2000;
const REPORT_ITEMS_LIMIT = 200;
/** Máximo de GTIN por consulta à plataforma (o contrato dela). */
const LOOKUP_CHUNK = 100;
const CATALOG_TAKEN = 'Esta peça do catálogo já está no estoque da oficina';

export interface CreateFromCatalogInput {
  catalogSku: string;
  /** Código interno da oficina; sem ele, vale o número da peça no catálogo. */
  sku?: string;
  costPrice: number;
  sellPrice: number;
  supplierName?: string | null;
}

export interface LinkByBarcodeReport {
  scanned: number;
  /** Havia mais peças candidatas que o limite por chamada: rode de novo para as demais. */
  truncated: boolean;
  summary: { linkable: number; ambiguousCatalog: number; ambiguousLocal: number; conflict: number; noMatch: number; linked: number };
  items: LinkVerdict[];
}

const chunk = <T>(xs: T[], size: number): T[][] => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

/**
 * Vínculo das peças da oficina com o catálogo global (docs/specs/parts-search-integration.md §9). Tudo aqui é fluxo de USUÁRIO: a plataforma é
 * consultada com o token da própria pessoa (`CallerContext`). O casamento automático da NF-e dentro do lote da SEFAZ (job sem usuário) continua
 * só local, até existir identidade de serviço por organização (§6).
 */
@Injectable()
export class PartCatalogLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: CatalogPlatformService,
  ) {}

  /** A peça existe no catálogo e está viva. */
  private async liveCatalogPart(caller: CallerContext, catalog: string, catalogSku: string) {
    const { items } = await this.platform.lookupParts(caller, catalog, [catalogSku]);
    const item = items.find((i) => i.sku === catalogSku);
    if (!item) throw new NotFoundException('Peça não encontrada no catálogo');
    if (item.retired || !item.active) throw new UnprocessableEntityException('Peça retirada ou inativa no catálogo');
    return item;
  }

  private isUnique(err: unknown): boolean {
    return (err as { code?: string })?.code === 'P2002';
  }

  /**
   * Violação de unicidade ao CRIAR: ou a peça do catálogo já está no estoque, ou o SKU interno já existe. O erro do Prisma não diz qual (com o cliente de
   * tenant, `meta.target` vem nulo), então a causa se descobre olhando o banco, com a RLS da própria oficina.
   */
  private async explainCreateConflict(err: unknown, catalogSku: string): Promise<unknown> {
    if (!this.isUnique(err)) return err;
    const holder = await this.prisma.part.findFirst({ where: { catalogSku }, select: { id: true } });
    return new ConflictException(holder ? CATALOG_TAKEN : 'Já existe uma peça com este SKU');
  }

  /** Cria a peça da oficina a partir de uma peça do catálogo: nome, GTIN e (por padrão) o SKU vêm de lá, e o vínculo nasce junto. */
  async createFromCatalog(caller: CallerContext, catalog: string, input: CreateFromCatalogInput) {
    const item = await this.liveCatalogPart(caller, catalog, input.catalogSku);
    try {
      return await this.prisma.part.create({
        data: {
          sku: input.sku ?? item.partNumber,
          name: item.name,
          ean: item.barcodes[0] ?? null,
          costPrice: input.costPrice,
          sellPrice: input.sellPrice,
          supplierName: input.supplierName ?? null,
          catalogSku: input.catalogSku,
          catalogLinkedAt: new Date(),
          catalogLinkSource: 'CREATED_FROM_CATALOG',
        },
      });
    } catch (err) {
      throw await this.explainCreateConflict(err, input.catalogSku);
    }
  }

  /** Vincula uma peça local a uma peça do catálogo (escolha da pessoa). Só vincula peça ainda sem vínculo. */
  async link(caller: CallerContext, catalog: string, partId: string, catalogSku: string) {
    const part = await this.prisma.part.findUnique({ where: { id: partId }, select: { id: true, catalogSku: true } });
    if (!part) throw new NotFoundException('Peça não encontrada');
    if (part.catalogSku !== null) throw new ConflictException('Esta peça já está vinculada ao catálogo');
    await this.liveCatalogPart(caller, catalog, catalogSku);
    let count: number;
    try {
      ({ count } = await this.prisma.part.updateMany({
        where: { id: partId, catalogSku: null },
        data: { catalogSku, catalogLinkedAt: new Date(), catalogLinkSource: 'MANUAL' },
      }));
    } catch (err) {
      // Aqui só o vínculo muda (o SKU não): unicidade violada é sempre "essa peça do catálogo já é de outra peça da oficina".
      throw this.isUnique(err) ? new ConflictException(CATALOG_TAKEN) : err;
    }
    if (count === 0) throw new ConflictException('A peça foi vinculada por outra pessoa');
    return { id: partId, catalogSku };
  }

  /** Solta o vínculo (os três campos juntos). Peça sem vínculo: nada a fazer. */
  async unlink(partId: string): Promise<void> {
    const part = await this.prisma.part.findUnique({ where: { id: partId }, select: { id: true, catalogSku: true } });
    if (!part) throw new NotFoundException('Peça não encontrada');
    if (part.catalogSku === null) return;
    await this.prisma.part.update({ where: { id: partId }, data: { catalogSku: null, catalogLinkedAt: null, catalogLinkSource: null } });
  }

  private async barcodeMatches(caller: CallerContext, catalog: string, eans: string[]) {
    const matches: { barcode: string; skus: string[] }[] = [];
    for (const group of chunk([...new Set(eans)], LOOKUP_CHUNK)) {
      matches.push(...(await this.platform.lookupBarcodes(caller, catalog, group)).matches);
    }
    return matches;
  }

  /**
   * Vincula em lote as peças sem vínculo pelo GTIN. Só o veredito `LINKABLE` (GTIN de exatamente uma peça do catálogo, livre) é gravado, e só com
   * `apply`; ambiguidade e conflito ficam para a pessoa. O relatório diz o que aconteceu com cada uma (limitado) e traz os totais de tudo.
   */
  async linkByBarcode(caller: CallerContext, catalog: string, opts: { apply: boolean }): Promise<LinkByBarcodeReport> {
    const rows = await this.prisma.part.findMany({
      where: { catalogSku: null, ean: { not: null } },
      select: { id: true, ean: true },
      orderBy: { id: 'asc' },
      take: LINK_BATCH_LIMIT + 1,
    });
    const truncated = rows.length > LINK_BATCH_LIMIT;
    const parts = rows.slice(0, LINK_BATCH_LIMIT).map((p) => ({ id: p.id, ean: p.ean! }));
    if (parts.length === 0) {
      return { scanned: 0, truncated: false, summary: { linkable: 0, ambiguousCatalog: 0, ambiguousLocal: 0, conflict: 0, noMatch: 0, linked: 0 }, items: [] };
    }

    const matches = await this.barcodeMatches(caller, catalog, parts.map((p) => p.ean));
    const candidateSkus = [...new Set(matches.flatMap((m) => m.skus))];
    const taken = candidateSkus.length
      ? await this.prisma.part.findMany({ where: { catalogSku: { in: candidateSkus } }, select: { id: true, catalogSku: true } })
      : [];
    const linkedMap = new Map(taken.map((p) => [p.catalogSku!, p.id]));

    let verdicts = classifyBarcodeLinks(parts, matches, linkedMap);
    let linked = 0;
    if (opts.apply) {
      verdicts = await Promise.all(
        verdicts.map(async (v): Promise<LinkVerdict> => {
          if (v.kind !== 'LINKABLE') return v;
          try {
            const { count } = await this.prisma.part.updateMany({
              where: { id: v.partId, catalogSku: null },
              data: { catalogSku: v.catalogSku, catalogLinkedAt: new Date(), catalogLinkSource: 'EAN' },
            });
            if (count === 1) {
              linked++;
              return v;
            }
          } catch (err) {
            if ((err as { code?: string })?.code !== 'P2002') throw err;
          }
          // Perdeu a corrida: outra pessoa vinculou a peça, ou a peça do catálogo já foi tomada por outra.
          return { kind: 'CONFLICT', partId: v.partId, catalogSku: v.catalogSku };
        }),
      );
    }

    const count = (kind: LinkVerdict['kind']) => verdicts.filter((v) => v.kind === kind).length;
    return {
      scanned: parts.length,
      truncated,
      summary: {
        linkable: count('LINKABLE'),
        ambiguousCatalog: count('AMBIGUOUS_CATALOG'),
        ambiguousLocal: count('AMBIGUOUS_LOCAL'),
        conflict: count('CONFLICT'),
        noMatch: count('NO_MATCH'),
        linked,
      },
      items: verdicts.slice(0, REPORT_ITEMS_LIMIT),
    };
  }

  /**
   * Para os itens da nota ainda sem resolução e com GTIN: a peça da oficina que JÁ está vinculada à peça do catálogo daquele GTIN. É só sugestão
   * (quem resolve é a pessoa, pelo fluxo manual da nota); GTIN ambíguo no catálogo ou sem peça vinculada não sugere.
   */
  async suggestForInvoice(caller: CallerContext, catalog: string, invoiceId: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
    if (!invoice) throw new NotFoundException('Nota não encontrada');
    const items = await this.prisma.purchaseInvoiceItem.findMany({
      where: { invoiceId, resolution: 'UNRESOLVED', ean: { not: null } },
      select: { id: true, ean: true },
    });
    if (items.length === 0) return { suggestions: [] as { itemId: string; partId: string; catalogSku: string }[], unmatched: 0 };

    const matches = await this.barcodeMatches(caller, catalog, items.map((i) => i.ean!));
    const skuByEan = new Map(matches.filter((m) => m.skus.length === 1).map((m) => [m.barcode, m.skus[0]!]));
    const wanted = [...new Set(skuByEan.values())];
    const parts = wanted.length ? await this.prisma.part.findMany({ where: { catalogSku: { in: wanted } }, select: { id: true, catalogSku: true } }) : [];
    const partBySku = new Map(parts.map((p) => [p.catalogSku!, p.id]));

    const suggestions: { itemId: string; partId: string; catalogSku: string }[] = [];
    for (const item of items) {
      const catalogSku = skuByEan.get(item.ean!);
      const partId = catalogSku ? partBySku.get(catalogSku) : undefined;
      if (catalogSku && partId) suggestions.push({ itemId: item.id, partId, catalogSku });
    }
    return { suggestions, unmatched: items.length - suggestions.length };
  }
}
