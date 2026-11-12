import { Module } from '@nestjs/common';
import { WorkforceConfig } from './workforce.config.js';
import { WorkforceController } from './workforce.controller.js';
import { WorkforceService } from './workforce.service.js';

/** Equipe da oficina: cadastro de pessoas, vínculos e funções, vindo do serviço workforce da plataforma. */
@Module({
  controllers: [WorkforceController],
  providers: [WorkforceConfig, WorkforceService],
})
export class WorkforceModule {}
