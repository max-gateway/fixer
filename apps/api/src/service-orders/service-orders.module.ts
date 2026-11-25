import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module.js';
import { VehicleVariantsModule } from '../vehicle-variants/vehicle-variants.module.js';
import { ServiceOrdersController } from './service-orders.controller.js';
import { ServiceOrdersService } from './service-orders.service.js';

/**
 * Ordens de serviço: criação (orçamento), listagem e transições de status.
 * Regras de estoque (débito na aprovação, devolução no cancelamento) vivem em
 * ServiceOrdersService.transition; a máquina de estados em status.ts.
 */
@Module({
  imports: [VehicleVariantsModule, LearningModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService],
})
export class ServiceOrdersModule {}
