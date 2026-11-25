import { Logger, Module } from '@nestjs/common';
import { ControlPlaneClient } from '../control-plane/control-plane.client.js';
import { ControlPlaneConfig } from '../control-plane/control-plane.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessAudit } from './access-audit.service.js';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';
import { ControlPlaneDirectory } from './directory/control-plane.directory.js';
import { DisabledDirectory, MEMBER_DIRECTORY, type MemberDirectory } from './directory/member-directory.js';

/**
 * Controle de acesso (pessoas, papéis, permissões, auditoria). Pessoas, convites e contas são do control plane da Max Gateway, que entra pela porta
 * `MEMBER_DIRECTORY`; o Fixer não tem credencial de administração do Keycloak. Sem `CONTROL_PLANE_URL` e `CONTROL_PLANE_API_KEY` o diretório fica desligado
 * (a tela funciona com quem já entrou no Fixer, sem convites).
 */
@Module({
  controllers: [AccessController],
  providers: [
    AccessService,
    AccessAudit,
    {
      provide: MEMBER_DIRECTORY,
      inject: [ControlPlaneConfig, ControlPlaneClient, PrismaService],
      useFactory: (cfg: ControlPlaneConfig, client: ControlPlaneClient, prisma: PrismaService): MemberDirectory => {
        if (!cfg.url || !cfg.apiKey) {
          new Logger('AccessModule').warn('Integração com o control plane desligada (sem CONTROL_PLANE_URL/CONTROL_PLANE_API_KEY): convites indisponíveis.');
          return new DisabledDirectory();
        }
        return new ControlPlaneDirectory(client, prisma);
      },
    },
  ],
})
export class AccessModule {}
