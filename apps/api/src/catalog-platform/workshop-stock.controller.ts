import { Controller, Get, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/parse.js';
import { callerFrom, pickCatalog, type PlatformRequest } from './catalog-platform.controller.js';
import { STOCK_LOOKUP_MAX, WorkshopStockService } from './workshop-stock.service.js';

const skus = z
  .union([z.string().min(1).max(64), z.array(z.string().min(1).max(64))])
  .transform((v) => [...new Set(Array.isArray(v) ? v : [v])])
  .pipe(z.array(z.string()).min(1).max(STOCK_LOOKUP_MAX));
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
/** Querystring: só o texto "true" liga. */
const flag = z.enum(['true', 'false']).transform((v) => v === 'true');

const StockParams = z.object({ skus }).strict();
const ListParams = z
  .object({
    q: z.string().trim().max(200).optional(),
    inStock: flag.optional(),
    page: int(1, 1000).optional(),
    limit: int(1, 50).optional(),
    catalog: z.string().min(1).max(64).optional(),
  })
  .strict();

/** A oficina dentro da busca de peças: o estoque local cruzado com o catálogo global. Só leitura. */
@Controller('catalog/workshop')
export class WorkshopStockController {
  constructor(private readonly stock: WorkshopStockService) {}

  /** Saldo e preço de venda da oficina para os skus do catálogo de uma página de resultados. */
  @Get('stock')
  async stockOf(@Query() query: unknown) {
    return { items: await this.stock.stockOf(parse(StockParams, query).skus) };
  }

  /** "Só o que tenho": as peças do catálogo que a oficina já cadastrou. */
  @Get('parts')
  async parts(@Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog, q, inStock, page, limit } = parse(ListParams, query);
    return this.stock.list(callerFrom(req), pickCatalog(req, catalog), { ...(q ? { q } : {}), ...(inStock ? { inStock } : {}), page: page ?? 1, limit: limit ?? 24 });
  }
}
