import { Module } from '@nestjs/common';
import { CatalogPlatformController } from './catalog-platform.controller.js';
import { CatalogPlatformService } from './catalog-platform.service.js';
import { PartsSearchConfig } from './parts-search.config.js';

/**
 * Integração com a plataforma de catálogo (parts-search): busca e consulta em lote do cadastro global, com a identidade do usuário
 * ponta a ponta (docs/specs/parts-search-integration.md). Só leitura; preço e saldo viram oferta na fase W.
 */
@Module({
  controllers: [CatalogPlatformController],
  providers: [PartsSearchConfig, CatalogPlatformService],
  exports: [CatalogPlatformService],
})
export class CatalogPlatformModule {}
