import { Module } from '@nestjs/common';
import { LearningController } from './learning.controller.js';
import { LearningService } from './learning.service.js';

/** Aprendizado de horas por serviço × veículo (docs/specs/service-catalog.md §5–§6). */
@Module({
  controllers: [LearningController],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}
