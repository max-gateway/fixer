import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { TenantDirectory } from '../tenancy/tenant-directory.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { ProvisioningService } from './provisioning.service.js';

/**
 * O provisionamento só roda quando a organização nasce, então uma permissão nova do catálogo nunca chegaria ao Admin das
 * organizações que já existem (a tela responderia 403 para o próprio dono). No boot, cada organização com papel Admin é
 * ressincronizada com o catálogo. Idempotente (ON CONFLICT DO NOTHING) e barato: uma consulta por organização.
 */
@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(
    private readonly directory: TenantDirectory,
    private readonly provisioning: ProvisioningService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const orgs = await this.directory.orgsWithAdminRole();
      for (const orgId of orgs) {
        await TenantContext.run(orgId, () => this.provisioning.ensureAdminRole()).catch((err) =>
          this.logger.warn(`Permissões do Admin não sincronizadas (org ${orgId}): ${(err as Error).message}`),
        );
      }
      if (orgs.length > 0) this.logger.log(`Permissões do Admin sincronizadas em ${orgs.length} organização(ões).`);
    } catch (err) {
      // Nunca impede a API de subir: o pior caso é o comportamento anterior.
      this.logger.warn(`Sincronização de permissões ignorada: ${(err as Error).message}`);
    }
  }
}
