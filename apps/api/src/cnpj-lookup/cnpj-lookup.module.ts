import { Module } from '@nestjs/common';
import { CnpjLookupClient } from './cnpj-lookup.client.js';
import { CnpjLookupConfig } from './cnpj-lookup.config.js';
import { CnpjLookupController } from './cnpj-lookup.controller.js';
import { CnpjLookupService } from './cnpj-lookup.service.js';

/**
 * Expõe GET /customers/cnpj-lookup/:cnpj (dados da Receita + Inscrições Estaduais)
 * via o microservice apps/cnpj-lookup. Usado no cadastro de cliente PJ.
 */
@Module({
  controllers: [CnpjLookupController],
  providers: [CnpjLookupConfig, CnpjLookupClient, CnpjLookupService],
})
export class CnpjLookupModule {}
