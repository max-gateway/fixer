import { Module } from '@nestjs/common';
import { FiscalSettingsController } from './fiscal-settings.controller.js';
import { FiscalSettingsService } from './fiscal-settings.service.js';

/** Configuração fiscal da oficina, dados fiscais de peça/serviço e prontidão para emissão. */
@Module({
  controllers: [FiscalSettingsController],
  providers: [FiscalSettingsService],
  exports: [FiscalSettingsService],
})
export class FiscalSettingsModule {}
