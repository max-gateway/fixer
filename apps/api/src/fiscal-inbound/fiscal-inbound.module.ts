import { Module } from '@nestjs/common';
import { CostsModule } from '../costs/costs.module.js';
import { CredentialService, KEY_PROVIDER } from './credentials/credential.service.js';
import { EnvKeyProvider } from './crypto/key-provider.js';
import { FiscalInboundController } from './fiscal-inbound.controller.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { FISCAL_CONFIG, loadFiscalConfig } from './fiscal.config.js';
import { GatewayClient } from './gateway/gateway.client.js';
import { GATEWAY_CONFIG, loadGatewayConfig, type GatewayConfig } from './gateway/gateway.config.js';
import { GatewayConsumer } from './gateway/gateway.consumer.js';
import { DFE_SOURCE } from './sefaz/dfe-source.js';
import { SefazDfeClient } from './sefaz/sefaz-dfe.client.js';
import { ManifestService } from './sync/manifest.service.js';
import { SyncRunner } from './sync/sync.runner.js';
import { SyncScheduler } from './sync/sync.scheduler.js';
import { InvoiceTaxBackfill } from './tax/backfill.service.js';

/**
 * Importação automática de NF-e de compra (Distribuição DF-e). Ver docs/specs/nfe-import.md.
 * Fase 1: certificado, cifragem e parsers. Fase 2: cliente da SEFAZ, scheduler e gravação do lote. Sem `FISCAL_ENC_KEYS` a API sobe normalmente e o módulo
 * responde "indisponível" nos endpoints que dependem da chave.
 */
@Module({
  imports: [CostsModule],
  controllers: [FiscalInboundController, InvoicesController],
  providers: [
    CredentialService,
    { provide: KEY_PROVIDER, useFactory: () => EnvKeyProvider.fromEnv() },
    { provide: FISCAL_CONFIG, useFactory: () => loadFiscalConfig() },
    { provide: GATEWAY_CONFIG, useFactory: () => loadGatewayConfig() },
    { provide: GatewayClient, inject: [GATEWAY_CONFIG], useFactory: (cfg: GatewayConfig | null) => (cfg ? new GatewayClient(cfg) : null) },
    GatewayConsumer,
    SefazDfeClient,
    { provide: DFE_SOURCE, useExisting: SefazDfeClient },
    ManifestService,
    InvoicesService,
    SyncRunner,
    SyncScheduler,
    InvoiceTaxBackfill,
  ],
  exports: [CredentialService, ManifestService, InvoicesService, GatewayClient],
})
export class FiscalInboundModule {}
