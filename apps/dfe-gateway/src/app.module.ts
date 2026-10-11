import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditService } from './audit/audit.service.js';
import { CompaniesController } from './api/companies.controller.js';
import { CredentialInspectController } from './api/credential-inspect.controller.js';
import { CompanyService } from './companies/company.service.js';
import { CONFIG, loadConfig } from './config/config.js';
import { EnvKeyProvider } from './core/crypto/key-provider.js';
import { SefazDfeClient } from './core/sefaz/sefaz-dfe.client.js';
import { CredentialService, KEY_PROVIDER } from './credentials/credential.service.js';
import { Database } from './db/database.service.js';
import { RelayService } from './delivery/relay.service.js';
import { Transports } from './delivery/transports.js';
import { DocumentsService } from './documents/documents.service.js';
import { HealthController } from './health/health.controller.js';
import { Metrics } from './health/metrics.service.js';
import { ProblemFilter } from './common/problem.js';
import { SubscriptionService } from './subscriptions/subscription.service.js';
import { ManifestService } from './sync/manifest.service.js';
import { SyncRunner } from './sync/sync.runner.js';
import { SyncScheduler } from './sync/sync.scheduler.js';
import { DFE_SOURCE } from './sync/tokens.js';
import { AuthGuard } from './tenants/auth.guard.js';
import { TenantService } from './tenants/tenant.service.js';

@Module({
  controllers: [HealthController, CompaniesController, CredentialInspectController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: KEY_PROVIDER, useFactory: () => EnvKeyProvider.fromEnv() },
    { provide: DFE_SOURCE, inject: [CONFIG], useFactory: (cfg: ReturnType<typeof loadConfig>) => new SefazDfeClient(cfg.sefaz) },
    { provide: APP_FILTER, useClass: ProblemFilter },
    Database,
    Metrics,
    AuditService,
    TenantService,
    AuthGuard,
    CompanyService,
    CredentialService,
    DocumentsService,
    SubscriptionService,
    ManifestService,
    SyncRunner,
    Transports,
    // Ordem importa no shutdown: scheduler e relay param antes do pool fechar.
    SyncScheduler,
    RelayService,
  ],
})
export class AppModule {}
