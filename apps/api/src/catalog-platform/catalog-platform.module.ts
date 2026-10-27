import { Module } from '@nestjs/common';
import { CatalogPlatformController } from './catalog-platform.controller.js';
import { CatalogPlatformService } from './catalog-platform.service.js';
import { FiscalBackfillController, FiscalBackfillExport } from './fiscal-backfill-export.js';
import { FiscalObservationsService } from './fiscal-observations.service.js';
import { PartCatalogLinkController } from './part-catalog-link.controller.js';
import { PartCatalogLinkService } from './part-catalog-link.service.js';
import { PartsSearchConfig } from './parts-search.config.js';

/**
 * Integração com a plataforma de catálogo (parts-search): busca e consulta em lote do cadastro global, com a identidade do usuário
 * ponta a ponta (docs/specs/parts-search-integration.md): busca e consulta em lote do catálogo e vínculo das peças da oficina com ele.
 * Preço e saldo viram oferta na fase W.
 */
@Module({
  controllers: [CatalogPlatformController, PartCatalogLinkController, FiscalBackfillController],
  providers: [PartsSearchConfig, CatalogPlatformService, PartCatalogLinkService, FiscalObservationsService, FiscalBackfillExport],
  exports: [CatalogPlatformService, PartCatalogLinkService, FiscalObservationsService],
})
export class CatalogPlatformModule {}
