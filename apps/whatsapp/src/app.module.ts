import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api/api-key.guard.js';
import { CONFIG, loadConfig, type AppConfig } from './config/config.js';
import { Database } from './db/database.service.js';
import { Dispatcher } from './dispatch/dispatcher.service.js';
import { EventOutbox } from './events/event-outbox.js';
import { EventRelay } from './events/outbox-relay.service.js';
import { HealthController } from './health/health.controller.js';
import { Metrics } from './health/metrics.service.js';
import { MessagesController } from './messages/messages.controller.js';
import { MessagesService } from './messages/messages.service.js';
import { CloudApiProvider } from './provider/cloud-api.provider.js';
import { LogProvider } from './provider/log.provider.js';
import { PROVIDER } from './provider/provider.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';
import { WebhooksService } from './webhooks/webhooks.service.js';

@Module({
  controllers: [HealthController, MessagesController, WebhooksController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: PROVIDER,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) =>
        cfg.provider === 'cloud'
          ? new CloudApiProvider(cfg.meta)
          : new LogProvider(),
    },
    Database,
    Metrics,
    ApiKeyGuard,
    MessagesService,
    WebhooksService,
    EventOutbox,
    EventRelay,
    // Por último: no shutdown o Dispatcher termina o lote antes de o pool fechar.
    Dispatcher,
  ],
})
export class AppModule {}
