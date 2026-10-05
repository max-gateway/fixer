import { Module } from '@nestjs/common';
import { ServiceOrdersController } from './service-orders.controller.js';
import { ServiceOrdersService } from './service-orders.service.js';

/**
 * Ordens de serviço: criação (orçamento), listagem e transições de status.
 * Regras de estoque (débito na aprovação, devolução no cancelamento) vivem em
 * ServiceOrdersService.transition; a máquina de estados em status.ts.
 */
@Module({
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService],
})
export class ServiceOrdersModule {}
