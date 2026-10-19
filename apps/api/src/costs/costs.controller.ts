import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { RequireFeature } from '../control-plane/feature.guard.js';
import { CostSettingsSchema, CostsService, ExpenseBodySchema } from './costs.service.js';

/**
 * Despesas e perfil de custos da oficina (docs/specs/custos-e-impostos-ui.md, fase B). Ler exige `pricing.read`; mudar,
 * `pricing.write` (as permissões `costs.*` da spec entram quando o catálogo de permissões for revisto).
 */
@RequireFeature('fiscal')
@Controller('costs')
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  @Get()
  @RequirePermission('pricing.read')
  overview() {
    return this.costs.overview();
  }

  @Put('settings')
  @RequirePermission('pricing.write')
  settings(@Body() body: unknown) {
    return this.costs.saveSettings(parse(CostSettingsSchema, body));
  }

  @Post('expenses')
  @RequirePermission('pricing.write')
  create(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.costs.createExpense(parse(ExpenseBodySchema, body), user.email);
  }

  @Put('expenses/:id')
  @RequirePermission('pricing.write')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.costs.updateExpense(id, parse(ExpenseBodySchema, body), user.email);
  }

  @Delete('expenses/:id')
  @HttpCode(204)
  @RequirePermission('pricing.write')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.costs.deleteExpense(id, user.email);
  }

  /** Manda as OS e as contas pagas ao motor e devolve o rascunho do perfil com o impacto. */
  @Post('sync')
  @RequirePermission('pricing.write')
  sync() {
    return this.costs.sync();
  }

  @Post('publish')
  @RequirePermission('pricing.write')
  publish(@CurrentUser() user: AuthUser) {
    return this.costs.publish(user.email);
  }
}
