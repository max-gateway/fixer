import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { FiscalSettingsModule } from './fiscal-settings/fiscal-settings.module.js';
import { FiscalInboundModule } from './fiscal-inbound/fiscal-inbound.module.js';
import { CnpjLookupModule } from './cnpj-lookup/cnpj-lookup.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { LearningModule } from './learning/learning.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { PlateEventsModule } from './plate-events/plate-events.module.js';
import { PlateReadingsModule } from './plate-readings/plate-readings.module.js';
import { PlateLookupModule } from './plate-lookup/plate-lookup.module.js';
import { PortalModule } from './portal/portal.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ServiceOrdersModule } from './service-orders/service-orders.module.js';
import { VehicleVariantsModule } from './vehicle-variants/vehicle-variants.module.js';
import { WhatsappLinkModule } from './whatsapp-link/whatsapp-link.module.js';

@Module({
  imports: [PrismaModule, OutboxModule, AuthModule, PlateEventsModule, PlateLookupModule, CnpjLookupModule, CustomersModule, DashboardModule, CatalogModule, ServiceOrdersModule, VehicleVariantsModule, LearningModule, FiscalSettingsModule, PortalModule, PlateReadingsModule, WhatsappLinkModule, FiscalInboundModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
