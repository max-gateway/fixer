import { Module } from '@nestjs/common';
import { MarketplaceClient } from './marketplace.client.js';
import { MarketplaceConfig } from './marketplace.config.js';
import { MarketplaceController } from './marketplace.controller.js';
import { MarketplaceService } from './marketplace.service.js';

/** Contas do Mercado Livre da oficina, pelo serviço `marketplace` da plataforma. */
@Module({
  controllers: [MarketplaceController],
  providers: [MarketplaceConfig, MarketplaceClient, MarketplaceService],
})
export class MarketplaceModule {}
