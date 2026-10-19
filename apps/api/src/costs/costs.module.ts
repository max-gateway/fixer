import { Module } from '@nestjs/common';
import { CostEngineClient, CostEngineConfig } from './cost-engine.client.js';
import { CostProfileProvider } from './cost-profile.provider.js';
import { CostsController } from './costs.controller.js';
import { CostsService } from './costs.service.js';

/** Despesas e perfil de custos pelo motor de custos da plataforma (cost-engine). Desligado sem COST_ENGINE_URL/API_KEY. */
@Module({ controllers: [CostsController], providers: [CostEngineConfig, CostEngineClient, CostsService, CostProfileProvider], exports: [CostProfileProvider] })
export class CostsModule {}
