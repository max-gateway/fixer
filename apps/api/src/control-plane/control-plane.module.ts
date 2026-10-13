import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ControlPlaneEventsConsumer } from './control-plane-events.consumer.js';
import { ControlPlaneClient } from './control-plane.client.js';
import { ControlPlaneConfig } from './control-plane.config.js';
import { FeatureGuard } from './feature.guard.js';
import { LicenseGuard } from './license.guard.js';
import { LicenseService } from './license.service.js';
import { PlanLimits } from './plan-limits.service.js';
import { ProvisioningService } from './provisioning.service.js';
import { UsageReporter } from './usage-reporter.service.js';

/**
 * Integração com o control plane da Max Gateway: provisiona organizações novas e aplica o estado da assinatura.
 * Global porque o AuthService (login do dono) usa o ProvisioningService. Importe depois do AuthModule: o LicenseGuard
 * precisa rodar depois dos guards de autenticação.
 */
@Global()
@Module({
  providers: [
    ControlPlaneConfig,
    ControlPlaneClient,
    LicenseService,
    ProvisioningService,
    PlanLimits,
    UsageReporter,
    ControlPlaneEventsConsumer,
    { provide: APP_GUARD, useClass: LicenseGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
  exports: [ProvisioningService, LicenseService, PlanLimits],
})
export class ControlPlaneModule {}
