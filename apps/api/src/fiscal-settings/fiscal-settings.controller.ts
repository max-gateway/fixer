import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { FiscalSettingsService } from './fiscal-settings.service.js';
import { PartFiscalSchema, UpdateSettingsSchema, VerifySchema } from './schema.js';

@Controller()
export class FiscalSettingsController {
  constructor(private readonly fiscal: FiscalSettingsService) {}

  @Get('fiscal/settings')
  settings() {
    return this.fiscal.getSettings();
  }

  @Put('fiscal/settings')
  @RequirePermission('fiscal.manage')
  updateSettings(@Body() body: unknown) {
    return this.fiscal.updateSettings(parse(UpdateSettingsSchema, body));
  }

  @Patch('parts/:id/fiscal')
  @RequirePermission('fiscal.manage')
  updatePartFiscal(@Param('id') id: string, @Body() body: unknown) {
    return this.fiscal.updatePartFiscal(id, parse(PartFiscalSchema, body));
  }

  /** Confirmação do contador: só aceita dados completos; qualquer edição posterior a desfaz. */
  @Post('parts/:id/fiscal/verify')
  @RequirePermission('fiscal.verify')
  verifyPart(@Param('id') id: string, @Body() body: unknown) {
    return this.fiscal.verifyPart(id, parse(VerifySchema, body).verified);
  }

  @Post('fiscal/service-profiles/:id/verify')
  @RequirePermission('fiscal.verify')
  verifyServiceProfile(@Param('id') id: string, @Body() body: unknown) {
    return this.fiscal.verifyServiceProfile(id, parse(VerifySchema, body).verified);
  }

  @Get('service-orders/:id/fiscal-readiness')
  readiness(@Param('id') id: string) {
    return this.fiscal.orderReadiness(id);
  }
}
