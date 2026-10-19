import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { RequireFeature } from '../control-plane/feature.guard.js';
import { FiscalAutofillService, RunAutofillSchema } from './fiscal-autofill.service.js';

@RequireFeature('fiscal')
@Controller('fiscal/autofill')
export class FiscalAutofillController {
  constructor(private readonly autofill: FiscalAutofillService) {}

  @Get()
  @RequirePermission('invoices.read')
  provenance() {
    return this.autofill.provenance();
  }

  /** Preenche (envio do certificado, com o CNPJ dele) ou atualiza (sem CNPJ) a configuração fiscal pelas fontes oficiais. */
  @Post()
  @RequirePermission('fiscal.manage')
  run(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.autofill.run(parse(RunAutofillSchema, body ?? {}), { id: user.id, ip: req.ip });
  }
}
