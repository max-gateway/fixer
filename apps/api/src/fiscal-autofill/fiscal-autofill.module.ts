import { Module } from '@nestjs/common';
import { CnpjLookupModule } from '../cnpj-lookup/cnpj-lookup.module.js';
import { FiscalInboundModule } from '../fiscal-inbound/fiscal-inbound.module.js';
import { FiscalAutofillController } from './fiscal-autofill.controller.js';
import { FiscalAutofillScheduler } from './fiscal-autofill.scheduler.js';
import { FiscalAutofillService } from './fiscal-autofill.service.js';
import { IntegraContadorClient } from './integra-contador.client.js';
import { NfseParametrosClient } from './nfse-parametros.client.js';

/** Preenchimento automático da configuração fiscal (docs/specs/fiscal-autofill.md). */
@Module({
  imports: [CnpjLookupModule, FiscalInboundModule],
  controllers: [FiscalAutofillController],
  providers: [FiscalAutofillService, FiscalAutofillScheduler, NfseParametrosClient, IntegraContadorClient],
})
export class FiscalAutofillModule {}
