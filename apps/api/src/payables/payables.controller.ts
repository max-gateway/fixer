import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { RequireFeature } from '../control-plane/feature.guard.js';
import { todayIso } from './dates.js';
import {
  BulkSchema,
  CreatePayableSchema,
  DuplicatesQuerySchema,
  ExportQuerySchema,
  ListQuerySchema,
  PaySchema,
  PayablesService,
  UpdatePayableSchema,
} from './payables.service.js';

/** Contas a pagar: parcelas das notas de compra (geradas dos XMLs) e lançamentos manuais. */
@RequireFeature('fiscal')
@Controller('payables')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  @RequirePermission('payables.read')
  list(@Query() query: unknown) {
    return this.payables.list(parse(ListQuerySchema, query));
  }

  // Rotas fixas antes de `:id`, senão "summary" etc. seriam lidos como id.
  @Get('summary')
  @RequirePermission('payables.read')
  summary() {
    return this.payables.summary();
  }

  @Get('access')
  @RequirePermission('payables.read')
  access(@CurrentUser() user: AuthUser) {
    return this.payables.access(user.id);
  }

  @Get('forecast')
  @RequirePermission('payables.read')
  forecast() {
    return this.payables.forecast();
  }

  @Get('suppliers')
  @RequirePermission('payables.read')
  suppliers() {
    return this.payables.suppliers();
  }

  @Get('categories')
  @RequirePermission('payables.read')
  categories() {
    return this.payables.categories();
  }

  @Get('duplicates')
  @RequirePermission('payables.read')
  duplicates(@Query() query: unknown) {
    return this.payables.duplicates(parse(DuplicatesQuerySchema, query));
  }

  /** Lê valor e vencimento de uma linha digitável. Código inválido não é erro HTTP: devolve `ok: false` para a tela avisar. */
  @Get('barcode')
  @RequirePermission('payables.read')
  barcode(@Query('code') code: string) {
    return this.payables.parseBarcode(code ?? '');
  }

  @Get('export')
  @RequirePermission('payables.read')
  async export(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const csv = await this.payables.exportCsv(parse(ExportQuerySchema, query));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contas-a-pagar-${todayIso()}.csv"`);
    return csv;
  }

  @Post('bulk')
  @RequirePermission('payables.pay')
  bulk(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const input = parse(BulkSchema, body);
    return this.payables.bulk(input, user);
  }

  @Get(':id')
  @RequirePermission('payables.read')
  get(@Param('id') id: string) {
    return this.payables.get(id);
  }

  @Post()
  @RequirePermission('payables.manage')
  create(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.payables.create(parse(CreatePayableSchema, body), user);
  }

  @Patch(':id')
  @RequirePermission('payables.manage')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.payables.update(id, parse(UpdatePayableSchema, body), user);
  }

  @Post(':id/pay')
  @RequirePermission('payables.pay')
  pay(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.payables.pay(id, parse(PaySchema, body ?? {}), user);
  }

  @Post(':id/unpay')
  @RequirePermission('payables.pay')
  unpay(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payables.unpay(id, user);
  }

  @Post(':id/cancel')
  @RequirePermission('payables.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payables.cancel(id, user);
  }
}
