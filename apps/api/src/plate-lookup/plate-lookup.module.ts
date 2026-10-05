import { Module } from '@nestjs/common';
import { PlateLookupClient } from './plate-lookup.client.js';
import { PlateLookupConfig } from './plate-lookup.config.js';
import { PlateLookupController } from './plate-lookup.controller.js';
import { PlateLookupService } from './plate-lookup.service.js';

/**
 * Expõe GET /vehicles/plate-lookup/:placa, que consulta dados de um veículo
 * pela placa via o microservice apps/plate-lookup (Python) — que por sua vez
 * chama a API Puxa Placa. Ver README.md deste diretório para o desenho
 * completo, especialmente a regra de "consulta só uma vez por placa".
 */
@Module({
  controllers: [PlateLookupController],
  providers: [PlateLookupConfig, PlateLookupClient, PlateLookupService],
  exports: [PlateLookupService],
})
export class PlateLookupModule {}
