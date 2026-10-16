import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { RequireFeature } from '../control-plane/feature.guard.js';
import { InvoicesService } from '../fiscal-inbound/invoices.service.js';
import { BulkSchema, DraftSchema, PricingModeSchema, PricingService, ReviewSchema, RuleSchema, ScopedRuleSchema, TaxFlagsSchema, TaxProfileSchema } from './pricing.service.js';

/** Precificação a partir da nota de compra (docs/specs/pricing.md §6.1). */
@RequireFeature('fiscal')
@Controller()
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get('pricing/rule')
  @RequirePermission('pricing.read')
  rule() {
    return this.pricing.getRule();
  }

  @Put('pricing/rule')
  @RequirePermission('pricing.write')
  saveRule(@Body() body: unknown) {
    return this.pricing.saveRule(parse(RuleSchema, body));
  }

  @Get('pricing/rules')
  @RequirePermission('pricing.read')
  rules() {
    return this.pricing.listRules();
  }

  /** Exceção por fornecedor, NCM ou peça. A mais específica vence a padrão. */
  @Put('pricing/rules')
  @RequirePermission('pricing.write')
  saveScopedRule(@Body() body: unknown) {
    return this.pricing.saveScopedRule(parse(ScopedRuleSchema, body));
  }

  @Delete('pricing/rules/:id')
  @RequirePermission('pricing.write')
  deleteRule(@Param('id') id: string) {
    return this.pricing.deleteRule(id);
  }

  @Get('pricing/tax-profile')
  @RequirePermission('pricing.read')
  taxProfile() {
    return this.pricing.getTaxProfile();
  }

  @Get('pricing/tax-tables')
  @RequirePermission('pricing.read')
  taxTables() {
    return this.pricing.taxTables();
  }

  /** Validar uma tabela de regra é uma confirmação fiscal (contador): `fiscal.verify`, como a validação do perfil. */
  @Post('pricing/tax-tables/:id/review')
  @RequirePermission('fiscal.verify')
  reviewTaxTable(@Param('id') id: string, @Body() body: unknown) {
    return this.pricing.reviewTaxTable(id, parse(ReviewSchema, body));
  }

  @Put('pricing/tax-profile')
  @RequirePermission('pricing.write')
  saveTaxProfile(@Body() body: unknown) {
    return this.pricing.saveTaxProfile(parse(TaxProfileSchema, body));
  }

  /** Quem valida os percentuais (contador) precisa de `fiscal.verify`: é uma confirmação fiscal, não uma edição. */
  @Post('pricing/tax-profile/review')
  @RequirePermission('fiscal.verify')
  reviewTaxProfile(@Body() body: unknown) {
    return this.pricing.reviewTaxProfile(parse(ReviewSchema, body));
  }

  @Get('invoices/:id/pricing')
  @RequirePermission('pricing.read')
  preview(@Param('id') id: string) {
    return this.pricing.preview(id);
  }

  @Post('invoices/:id/pricing/bulk')
  @RequirePermission('pricing.write')
  bulk(@Param('id') id: string, @Body() body: unknown) {
    return this.pricing.bulk(id, parse(BulkSchema, body));
  }

  @Put('invoices/:id/items/:n/pricing')
  @RequirePermission('pricing.write')
  saveDraft(@Param('id') id: string, @Param('n', ParseIntPipe) n: number, @Body() body: unknown) {
    return this.pricing.saveDraft(id, n, parse(DraftSchema, body));
  }

  /** Lança a entrada e aplica os preços do plano. Sem esta rota o lançamento nunca mexe em preço. */
  @Post('invoices/:id/confirm-with-pricing')
  @RequirePermission('pricing.write')
  confirmWithPricing(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoices.confirm(id, user.id, { applyPricing: true });
  }

  @Get('parts/:id/price-history')
  @RequirePermission('pricing.read')
  history(@Param('id') id: string) {
    return this.pricing.history(id);
  }

  @Put('parts/:id/pricing-mode')
  @RequirePermission('pricing.write')
  setMode(@Param('id') id: string, @Body() body: unknown) {
    return this.pricing.setPricingMode(id, parse(PricingModeSchema, body).mode);
  }

  /** Confirmar o enquadramento tributário da peça (ST, monofásico) é ato fiscal: exige `fiscal.verify`. */
  @Put('parts/:id/tax-flags')
  @RequirePermission('fiscal.verify')
  setTaxFlags(@Param('id') id: string, @Body() body: unknown) {
    return this.pricing.setTaxFlags(id, parse(TaxFlagsSchema, body));
  }
}
