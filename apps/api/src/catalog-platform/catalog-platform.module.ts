import { Module } from '@nestjs/common';
import { PlateLookupModule } from '../plate-lookup/plate-lookup.module.js';
import { CatalogPlatformController } from './catalog-platform.controller.js';
import { CatalogPlatformService } from './catalog-platform.service.js';
import { FiscalBackfillController, FiscalBackfillExport } from './fiscal-backfill-export.js';
import { FiscalObservationsService } from './fiscal-observations.service.js';
import { PartCatalogLinkController } from './part-catalog-link.controller.js';
import { PartCatalogLinkService } from './part-catalog-link.service.js';
import { PartsSearchConfig } from './parts-search.config.js';
import { VehicleDirectoryController } from './vehicle-directory.controller.js';
import { WorkshopStockController } from './workshop-stock.controller.js';
import { WorkshopStockService } from './workshop-stock.service.js';

/**
 * Integração com a plataforma de catálogo (parts-search): busca e consulta em lote do cadastro global, com a identidade do usuário
 * ponta a ponta (docs/specs/parts-search-integration.md): busca e consulta em lote do catálogo e vínculo das peças da oficina com ele.
 * Preço e saldo viram oferta na fase W. A escolha do veículo usa o diretório de veículos da plataforma e a placa (consulta do Fixer).
 */
@Module({
  imports: [PlateLookupModule],
  controllers: [CatalogPlatformController, PartCatalogLinkController, FiscalBackfillController, WorkshopStockController, VehicleDirectoryController],
  providers: [PartsSearchConfig, CatalogPlatformService, PartCatalogLinkService, FiscalObservationsService, FiscalBackfillExport, WorkshopStockService],
  exports: [CatalogPlatformService, PartCatalogLinkService, FiscalObservationsService],
})
export class CatalogPlatformModule {}
