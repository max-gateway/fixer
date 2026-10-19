import { Module } from '@nestjs/common';
import { CostsModule } from '../costs/costs.module.js';
import { FiscalInboundModule } from '../fiscal-inbound/fiscal-inbound.module.js';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

@Module({ imports: [FiscalInboundModule, CostsModule], controllers: [PricingController], providers: [PricingService] })
export class PricingModule {}
