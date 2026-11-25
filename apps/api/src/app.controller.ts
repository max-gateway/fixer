import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/auth.decorators.js';
import { DirectorySyncService } from './tenancy/directory-sync.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService, private readonly directory: DirectorySyncService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Probes do Kubernetes (readiness/liveness no chart) — não podem exigir token.
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  // Sync do registro de organizações e membros: 503 se ligado e sem rodada boa há 3 intervalos. Fora de `health` (liveness) de propósito:
  // sync parado é alerta, não motivo para reiniciar o pod.
  @Public()
  @Get('health/tenant-sync')
  tenantSync() {
    const { statusCode, body } = this.directory.health();
    if (statusCode !== 200) throw new ServiceUnavailableException(body);
    return body;
  }
}
