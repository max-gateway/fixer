import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { makerCodeCandidates, partNumberKey } from '../fiscal-inbound/matching/maker-code.js';
import { classifyBarcodeLinks, type LinkVerdict } from './catalog-link.js';
import { CatalogPlatformService, type CallerContext } from './catalog-platform.service.js';

/** Peças examinadas por chamada do vínculo em lote, e quantos vereditos o relatório devolve (o resto vem só nos totais). */
const LINK_BATCH_LIMIT = 2000;
const REPORT_ITEMS_LIMIT = 200;
/** Máximo de GTIN por consulta à plataforma (o contrato dela). */
const LOOKUP_CHUNK = 100;
const CATALOG_TAKEN = 'Esta peça do catálogo já está no estoque da oficina';
/** Itens por chamada que vão à busca por código do fabricante (uma consulta por item); o resto fica para a próxima abertura da nota. */
const MAKER_SEARCH_LIMIT = 40;

/** A peça do catálogo que um item da nota é, e como se chegou a ela. */
export interface CatalogCandidate {
  catalogSku: string;
  via: 'GTIN' | 'PART_NUMBER';
}

export interface CreateFromCatalogInput {
  catalogSku: string;
  /** Código interno da oficina; sem ele, vale o número da peça no catálogo. */
  sku?: string;
  costPrice: number;
  sellPrice: number;
  supplierName?: string | null;
}

/** Sugestão para um item da nota: a peça da oficina (com nome e SKU, para a tela) já vinculada à peça do catálogo daquele GTIN. */
export interface InvoiceSuggestion {
  itemId: string;
  partId: string;
  partSku: string;
  partName: string;
  catalogSku: string;
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

  /** A peça existe no catálogo e está viva (404 se não existe, 422 se retirada ou inativa). Fluxos de usuário: o token da pessoa vai à plataforma. */
  async resolveLive(caller: CallerContext, catalog: string, catalogSku: string) {
    const { items } = await this.platform.lookupParts(caller, catalog, [catalogSku]);
    const item = items.find((i) => i.sku === catalogSku);
    if (!item) throw new NotFoundException('Peça não encontrada no catálogo');
    if (item.retired || !item.active) throw new UnprocessableEntityException('Peça retirada ou inativa no catálogo');
    return item;
  }

  /** Peças VIVAS (ativas e não retiradas) do catálogo, por sku; o que não existe ou foi retirado simplesmente não volta. */
  async lookupLive(caller: CallerContext, catalog: string, skus: string[]): Promise<{ items: Map<string, { sku: string; name: string; partNumber: string }> }> {
    const items = new Map<string, { sku: string; name: string; partNumber: string }>();
    for (const group of chunk(skus, LOOKUP_CHUNK)) {
      for (const i of (await this.platform.lookupParts(caller, catalog, group)).items) {
        if (!i.retired && i.active) items.set(i.sku, { sku: i.sku, name: i.name, partNumber: i.partNumber });
      }
    }
    return { items };
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
    const item = await this.resolveLive(caller, catalog, input.catalogSku);
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
    await this.resolveLive(caller, catalog, catalogSku);
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
   * A peça do catálogo de cada item da nota, quando é INEQUÍVOCA: primeiro pelo GTIN (um único sku ativo), depois pelo código do fabricante que o fornecedor
   * escreve na descrição (um único sku com aquele número de peça, comparado pela chave normalizada). Ambíguo ou ausente não entra: quem decide é a pessoa.
   */
  async candidatesForItems(caller: CallerContext, catalog: string, items: { id: string; ean: string | null; description: string }[]): Promise<Map<string, CatalogCandidate>> {
    const out = new Map<string, CatalogCandidate>();
    const withEan = items.filter((i) => i.ean);
    if (withEan.length > 0) {
      const matches = await this.barcodeMatches(caller, catalog, withEan.map((i) => i.ean!));
      const skuByEan = new Map(matches.filter((m) => m.skus.length === 1).map((m) => [m.barcode, m.skus[0]!]));
      for (const i of withEan) {
        const catalogSku = skuByEan.get(i.ean!);
        if (catalogSku) out.set(i.id, { catalogSku, via: 'GTIN' });
      }
    }
    for (const item of items.filter((i) => !out.has(i.id)).slice(0, MAKER_SEARCH_LIMIT)) {
      for (const code of makerCodeCandidates(item.description)) {
        const key = partNumberKey(code);
        const { data } = await this.platform.search(caller, catalog, { q: code, limit: 10 });
        const exact = [...new Set(data.filter((h) => partNumberKey(h.partNumber) === key).map((h) => h.sku))];
        if (exact.length === 1) {
          out.set(item.id, { catalogSku: exact[0]!, via: 'PART_NUMBER' });
          break;
        }
      }
    }
    return out;
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
    if (items.length === 0) return { suggestions: [] as InvoiceSuggestion[], unmatched: 0 };

    const matches = await this.barcodeMatches(caller, catalog, items.map((i) => i.ean!));
    const skuByEan = new Map(matches.filter((m) => m.skus.length === 1).map((m) => [m.barcode, m.skus[0]!]));
    const wanted = [...new Set(skuByEan.values())];
    const parts = wanted.length ? await this.prisma.part.findMany({ where: { catalogSku: { in: wanted } }, select: { id: true, sku: true, name: true, catalogSku: true } }) : [];
    const partBySku = new Map(parts.map((p) => [p.catalogSku!, p]));

    const suggestions: InvoiceSuggestion[] = [];
    for (const item of items) {
      const catalogSku = skuByEan.get(item.ean!);
      const part = catalogSku ? partBySku.get(catalogSku) : undefined;
      if (catalogSku && part) suggestions.push({ itemId: item.id, partId: part.id, partSku: part.sku, partName: part.name, catalogSku });
    }
    return { suggestions, unmatched: items.length - suggestions.length };
  }
}
