import { Module } from '@nestjs/common';
import { CatalogBootstrapService } from './catalog-bootstrap.service.js';
import { VehicleVariantsService } from './vehicle-variants.service.js';

/** Variantes de veículo normalizadas + aplicação do catálogo global na subida. */
@Module({
  providers: [VehicleVariantsService, CatalogBootstrapService],
  exports: [VehicleVariantsService],
})
export class VehicleVariantsModule {}
