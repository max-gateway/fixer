import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { PlateEventsModule } from './plate-events/plate-events.module.js';
import { PlateReadingsModule } from './plate-readings/plate-readings.module.js';
import { PlateLookupModule } from './plate-lookup/plate-lookup.module.js';
import { PortalModule } from './portal/portal.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ServiceOrdersModule } from './service-orders/service-orders.module.js';
import { WhatsappLinkModule } from './whatsapp-link/whatsapp-link.module.js';

@Module({
  imports: [PrismaModule, OutboxModule, AuthModule, PlateEventsModule, PlateLookupModule, CustomersModule, CatalogModule, ServiceOrdersModule, PortalModule, PlateReadingsModule, WhatsappLinkModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
