import { Module } from '@nestjs/common';
import { PlateEventsConfig } from './plate-events.config.js';
import { PlateEventsConsumerService } from './plate-events-consumer.service.js';
import { PlateEventsHandler } from './plate-events.handler.js';
import { PlateReadingsStore } from './plate-readings.store.js';

/**
 * Consome os eventos de leitura de placa publicados pelo microservice
 * `apps/plate-reader` (Python) via Redis Streams. Ver README.md deste
 * diretório para o desenho completo.
 */
@Module({
  providers: [PlateEventsConfig, PlateReadingsStore, PlateEventsHandler, PlateEventsConsumerService],
  exports: [PlateEventsHandler, PlateEventsConfig, PlateReadingsStore],
})
export class PlateEventsModule {}
