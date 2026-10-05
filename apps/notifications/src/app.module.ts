import { Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config/config.js';
import { Database } from './db/database.service.js';
import { ChannelRegistry } from './dispatch/channel-registry.js';
import { Dispatcher } from './dispatch/dispatcher.service.js';
import { DeliveriesController } from './api/deliveries.controller.js';
import { InboxController } from './api/inbox.controller.js';
import { AuthGuard } from './api/auth.guard.js';
import { InboxBus } from './inbox/inbox.bus.js';
import { InboxService } from './inbox/inbox.service.js';
import { HealthController } from './health/health.controller.js';
import { Metrics } from './health/metrics.service.js';
import { IngestService } from './ingest/ingest.service.js';
import { StreamConsumer } from './ingest/stream-consumer.service.js';

@Module({
  controllers: [HealthController, InboxController, DeliveriesController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    Database,
    Metrics,
    ChannelRegistry,
    AuthGuard,
    InboxBus,
    InboxService,
    IngestService,
    // Ordem importa no shutdown: consumer e dispatcher param antes do pool fechar.
    StreamConsumer,
    Dispatcher,
  ],
})
export class AppModule {}
