import { Logger, Module } from '@nestjs/common';
import { AccessAudit } from './access-audit.service.js';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';
import { DirectoryConfig } from './directory/directory.config.js';
import { KeycloakDirectory } from './directory/keycloak.directory.js';
import { DisabledDirectory, MEMBER_DIRECTORY, type MemberDirectory } from './directory/member-directory.js';

/**
 * Controle de acesso (pessoas, papéis, permissões, auditoria). O diretório de identidades entra pela porta
 * `MEMBER_DIRECTORY`: Keycloak quando há credencial de administração, senão um diretório desligado (a tela funciona
 * com quem já entrou no Fixer). Para trocar o provedor, troque só este `useFactory`.
 */
@Module({
  controllers: [AccessController],
  providers: [
    AccessService,
    AccessAudit,
    DirectoryConfig,
    {
      provide: MEMBER_DIRECTORY,
      inject: [DirectoryConfig],
      useFactory: (config: DirectoryConfig): MemberDirectory => {
        if (!config.enabled) {
          new Logger('AccessModule').warn('Diretório do Keycloak desligado (sem KEYCLOAK_ADMIN_CLIENT_ID/SECRET): convites indisponíveis.');
          return new DisabledDirectory();
        }
        return new KeycloakDirectory(config);
      },
    },
  ],
})
export class AccessModule {}
