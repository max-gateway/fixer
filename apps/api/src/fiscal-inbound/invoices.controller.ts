import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { RequirePermission } from '../auth/permissions.js';
import { RequireFeature } from '../control-plane/feature.guard.js';
import { parse } from '../common/parse.js';
import { callerFrom, pickCatalog, type PlatformRequest } from '../catalog-platform/catalog-platform.controller.js';
import { PartCatalogLinkService } from '../catalog-platform/part-catalog-link.service.js';
import { CreatePartSchema, InvoicesService, ItemActionSchema, ListQuerySchema } from './invoices.service.js';
import { ManifestService } from './sync/manifest.service.js';

/** Notas de compra recebidas da SEFAZ e a conciliação dos itens (docs/specs/nfe-import.md §8 e §11). */
@RequireFeature('fiscal')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly manifest: ManifestService,
    private readonly catalogLinks: PartCatalogLinkService,
  ) {}

  @Get()
  @RequirePermission('invoices.read')
  list(@Query() query: unknown) {
    return this.invoices.list(parse(ListQuerySchema, query));
  }

  // Declarada antes de `:id`, senão "summary" seria lido como id.
  @Get('summary')
  @RequirePermission('invoices.read')
  summary() {
    return this.invoices.summary();
  }

  @Get(':id')
  @RequirePermission('invoices.read')
  get(@Param('id') id: string) {
    return this.invoices.get(id);
  }

  @Get(':id/xml')
  @RequirePermission('invoices.read')
  async xml(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { filename, xml } = await this.invoices.xml(id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return xml;
  }

  /** "Dar ciência e baixar XML": usado quando `autoManifest` está desligado, ou para repetir uma rejeição. */
  @Post(':id/manifest')
  @RequirePermission('invoices.reconcile')
  manifestNow(@Param('id') id: string) {
    return this.manifest.manifestOne(id);
  }

  @Put(':id/items/:n')
  @RequirePermission('invoices.reconcile')
  setItem(@Param('id') id: string, @Param('n', ParseIntPipe) n: number, @Body() body: unknown) {
    return this.invoices.setItem(id, n, parse(ItemActionSchema, body));
  }

  @Post(':id/items/:n/create-part')
  @RequirePermission('invoices.reconcile')
  async createPart(@Param('id') id: string, @Param('n', ParseIntPipe) n: number, @Body() body: unknown, @Req() req: PlatformRequest) {
    const { catalog, ...input } = parse(CreatePartSchema, body);
    if (catalog !== undefined && input.catalogSku === undefined) throw new BadRequestException('O catálogo só vale junto com a peça do catálogo');
    if (input.catalogSku === undefined) return this.invoices.createPartFromItem(id, n, input, undefined);
    // A peça do catálogo é resolvida ANTES da transação, com o token da própria pessoa; nome e SKU padrão vêm de lá, nunca do corpo.
    const live = await this.catalogLinks.resolveLive(callerFrom(req), pickCatalog(req, catalog), input.catalogSku);
    return this.invoices.createPartFromItem(id, n, input, { sku: live.sku, name: live.name, partNumber: live.partNumber });
  }

  /** Lança a entrada no estoque (nota READY). */
  @Post(':id/confirm')
  @RequirePermission('invoices.reconcile')
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoices.confirm(id, user.id);
  }

  @Post(':id/clear-review')
  @RequirePermission('invoices.reconcile')
  clearReview(@Param('id') id: string) {
    return this.invoices.clearReview(id);
  }
}
