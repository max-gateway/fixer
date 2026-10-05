import { Module } from '@nestjs/common';
import { PlateEventsModule } from '../plate-events/plate-events.module.js';
import { PlateReadingsController } from './plate-readings.controller.js';
import { PlateReadingsService } from './plate-readings.service.js';

/**
 * Leitura de placa por foto (OCR) para o frontend: POST /plate-readings envia a
 * imagem ao apps/plate-reader; GET /plate-readings/:requestId devolve o resultado,
 * gravado pelo PlateEventsHandler quando o evento chega pelo Redis Stream.
 */
@Module({
  imports: [PlateEventsModule],
  controllers: [PlateReadingsController],
  providers: [PlateReadingsService],
})
export class PlateReadingsModule {}
