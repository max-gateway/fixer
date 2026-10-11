import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { CreatePartSchema, InvoicesService, ItemActionSchema, ListQuerySchema } from './invoices.service.js';
import { ManifestService } from './sync/manifest.service.js';

/** Notas de compra recebidas da SEFAZ e a conciliação dos itens (docs/specs/nfe-import.md §8 e §11). */
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly manifest: ManifestService,
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
  createPart(@Param('id') id: string, @Param('n', ParseIntPipe) n: number, @Body() body: unknown) {
    return this.invoices.createPartFromItem(id, n, parse(CreatePartSchema, body));
  }

  @Post(':id/clear-review')
  @RequirePermission('invoices.reconcile')
  clearReview(@Param('id') id: string) {
    return this.invoices.clearReview(id);
  }
}
