import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogPlatformService, type CallerContext } from './catalog-platform.service.js';

/** Máximo de skus por consulta (o mesmo teto da consulta em lote da plataforma). */
export const STOCK_LOOKUP_MAX = 100;

/** O que a tela precisa saber da peça da oficina que representa uma peça do catálogo. Sem custo: a busca é de balcão. */
export interface WorkshopStockItem {
  catalogSku: string;
  partId: string;
  /** Código interno da oficina. */
  sku: string;
  stockQty: number;
  sellPrice: number;
}

export interface WorkshopPartsQuery {
  q?: string;
  inStock?: boolean;
  page: number;
  limit: number;
}

/** Peça do catálogo vinculada à oficina, no mesmo formato do resultado da busca mais o que a oficina tem dela. */
export interface WorkshopPartHit {
  sku: string;
  name: string;
  label: string;
  partNumber: string;
  brand?: { key: string; name: string };
  category?: { id: string; name: string };
  imageUrl?: string;
  isUniversalFit: boolean;
  relevanceScore: number;
  workshop: WorkshopStockItem;
}

/**
 * Estoque da oficina visto pela busca de peças. O Fixer não publica ofertas na plataforma: preço de venda e saldo são da peça local (Postgres, com a
 * RLS da organização), então o cruzamento com o resultado da busca é feito aqui, pelo vínculo `Part.catalogSku`.
 */
@Injectable()
export class WorkshopStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: CatalogPlatformService,
  ) {}

  /** Peças da oficina vinculadas a estes skus do catálogo (os que não têm vínculo simplesmente não voltam). */
  async stockOf(catalogSkus: string[]): Promise<WorkshopStockItem[]> {
    const parts = await this.prisma.part.findMany({
      where: { catalogSku: { in: catalogSkus } },
      select: { id: true, sku: true, stockQty: true, sellPrice: true, catalogSku: true },
    });
    return parts.map(toItem);
  }

  /**
   * "Só o que tenho": as peças vinculadas ao catálogo, por nome ou código interno da oficina, com a ficha resumida buscada na plataforma. Peça do catálogo
   * que sumiu de lá (`missing`) não aparece: sem ficha não há o que mostrar, e o total continua sendo o da oficina.
   */
  async list(caller: CallerContext, catalog: string, query: WorkshopPartsQuery) {
    const text = query.q?.trim();
    const where = {
      catalogSku: { not: null },
      ...(query.inStock ? { stockQty: { gt: 0 } } : {}),
      ...(text ? { OR: [{ name: { contains: text, mode: 'insensitive' as const } }, { sku: { contains: text, mode: 'insensitive' as const } }] } : {}),
    };
    const [total, parts] = await Promise.all([
      this.prisma.part.count({ where }),
      this.prisma.part.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: { id: true, sku: true, stockQty: true, sellPrice: true, catalogSku: true },
      }),
    ]);
    const local = new Map(parts.map((p) => [p.catalogSku!, toItem(p)]));
    const data: WorkshopPartHit[] = [];
    if (local.size > 0) {
      const { items } = await this.platform.lookupParts(caller, catalog, [...local.keys()]);
      const byCatalog = new Map(items.map((i) => [i.sku, i]));
      // A ordem é a da oficina (nome), não a da resposta da plataforma.
      for (const [sku, workshop] of local) {
        const item = byCatalog.get(sku);
        if (!item) continue;
        data.push({
          sku,
          name: item.name,
          label: item.name,
          partNumber: item.partNumber,
          ...(item.brand ? { brand: item.brand } : {}),
          ...(item.category ? { category: item.category } : {}),
          ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
          isUniversalFit: false,
          relevanceScore: 0,
          workshop,
        });
      }
    }
    return { data, page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) };
  }
}

function toItem(p: { id: string; sku: string; stockQty: unknown; sellPrice: unknown; catalogSku: string | null }): WorkshopStockItem {
  return { catalogSku: p.catalogSku!, partId: p.id, sku: p.sku, stockQty: Number(p.stockQty), sellPrice: Number(p.sellPrice) };
}
