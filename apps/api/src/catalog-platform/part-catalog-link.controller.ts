import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { callerFrom, pickCatalog, type PlatformRequest } from './catalog-platform.controller.js';
import { PartCatalogLinkService } from './part-catalog-link.service.js';

const catalogName = z.string().min(1).max(64);
const money = z.number().nonnegative('Valor não pode ser negativo');

/** Nome e GTIN NÃO entram: vêm do catálogo, nunca de quem pede. Campo desconhecido é 400. */
const FromCatalog = z
  .object({
    catalogSku: z.string().trim().min(1).max(64),
    sku: z.string().trim().min(1).max(64).optional(),
    costPrice: money,
    sellPrice: money,
    supplierName: z.string().trim().nullable().optional(),
    catalog: catalogName.optional(),
  })
  .strict();
const LinkBody = z.object({ catalogSku: z.string().trim().min(1).max(64), catalog: catalogName.optional() }).strict();
/** `apply` só vale como booleano de verdade: gravar em lote exige intenção explícita (o texto "true" não conta). */
const ByBarcode = z.object({ apply: z.boolean().optional(), catalog: catalogName.optional() }).strict();

/**
 * Vínculo das peças da oficina com o catálogo global da plataforma (docs/specs/parts-search-integration.md §9). Tudo aqui é fluxo de usuário:
 * a plataforma é consultada com o token da própria pessoa.
 */
@Controller()
export class PartCatalogLinkController {
  constructor(private readonly links: PartCatalogLinkService) {}

  /** Cria a peça da oficina a partir de uma peça do catálogo. Segue a regra de `POST /parts` (criar peça não tem permissão própria). */
  @Post('parts/from-catalog')
  async fromCatalog(@Body() body: unknown, @Req() req: PlatformRequest) {
    const { catalog, ...input } = parse(FromCatalog, body);
    return this.links.createFromCatalog(callerFrom(req), pickCatalog(req, catalog), input);
  }

  @Put('parts/:id/catalog-link')
  @RequirePermission('catalog.link')
  async link(@Param('id') id: string, @Body() body: unknown, @Req() req: PlatformRequest) {
    const { catalog, catalogSku } = parse(LinkBody, body);
    return this.links.link(callerFrom(req), pickCatalog(req, catalog), id, catalogSku);
  }

  @Delete('parts/:id/catalog-link')
  @RequirePermission('catalog.link')
  @HttpCode(204)
  async unlink(@Param('id') id: string): Promise<void> {
    await this.links.unlink(id);
  }

  /** Vínculo em lote pelo GTIN. Sem `apply` só mostra o que faria. */
  @Post('parts/catalog-links/by-barcode')
  @RequirePermission('catalog.link')
  @HttpCode(200)
  async linkByBarcode(@Body() body: unknown, @Req() req: PlatformRequest) {
    const { catalog, apply } = parse(ByBarcode, body ?? {});
    return this.links.linkByBarcode(callerFrom(req), pickCatalog(req, catalog), { apply: apply ?? false });
  }

  /** Sugere, para os itens ainda sem resolução da nota, a peça da oficina já vinculada ao catálogo pelo GTIN. */
  @Get('invoices/:id/catalog-suggestions')
  @RequirePermission('invoices.reconcile')
  async suggestions(@Param('id') id: string, @Req() req: PlatformRequest) {
    return this.links.suggestForInvoice(callerFrom(req), pickCatalog(req, undefined), id);
  }
}
