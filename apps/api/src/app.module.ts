import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { FiscalSettingsModule } from './fiscal-settings/fiscal-settings.module.js';
import { FiscalInboundModule } from './fiscal-inbound/fiscal-inbound.module.js';
import { CnpjLookupModule } from './cnpj-lookup/cnpj-lookup.module.js';
import { ControlPlaneModule } from './control-plane/control-plane.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { LearningModule } from './learning/learning.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { PlateEventsModule } from './plate-events/plate-events.module.js';
import { PlateReadingsModule } from './plate-readings/plate-readings.module.js';
import { PlateLookupModule } from './plate-lookup/plate-lookup.module.js';
import { PortalController } from './portal/portal.controller.js';
import { PortalModule } from './portal/portal.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ServiceOrdersModule } from './service-orders/service-orders.module.js';
import { PortalTenantMiddleware, TenantMiddleware } from './tenancy/tenant.middleware.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { VehicleVariantsModule } from './vehicle-variants/vehicle-variants.module.js';
import { WhatsappLinkModule } from './whatsapp-link/whatsapp-link.module.js';

@Module({
  imports: [PrismaModule, TenancyModule, OutboxModule, AuthModule, ControlPlaneModule, PlateEventsModule, PlateLookupModule, CnpjLookupModule, CustomersModule, DashboardModule, CatalogModule, ServiceOrdersModule, VehicleVariantsModule, LearningModule, FiscalSettingsModule, PortalModule, PlateReadingsModule, WhatsappLinkModule, FiscalInboundModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Rotas autenticadas: a organização vem do token. Portal público: vem do dono do token da URL.
    consumer.apply(PortalTenantMiddleware).forRoutes(PortalController);
    consumer.apply(TenantMiddleware).exclude('portal/(.*)', 'me/(.*)').forRoutes('*');
  }
}
