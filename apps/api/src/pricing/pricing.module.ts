import { Module } from '@nestjs/common';
import { FiscalInboundModule } from '../fiscal-inbound/fiscal-inbound.module.js';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

@Module({ imports: [FiscalInboundModule], controllers: [PricingController], providers: [PricingService] })
export class PricingModule {}
