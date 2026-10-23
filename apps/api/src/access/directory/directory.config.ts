import { Injectable } from '@nestjs/common';
import type { DirectoryMode } from './member-directory.js';

/**
 * Credencial de administração do Keycloak (client confidencial com service account). Opcional: sem ela a tela de acessos
 * funciona com quem já entrou no Fixer (papéis, permissões, ativar/desativar), mas não convida nem lista o diretório.
 *
 * O service account precisa, no client `realm-management`: `view-users`, `manage-users` e, no modo `organization`,
 * `manage-realm` (exigido pela API de Organizations do Keycloak 26). `scripts/keycloak-access-client.mjs` cria tudo.
 */
@Injectable()
export class DirectoryConfig {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly mode: Exclude<DirectoryMode, 'disabled'>;
  /** Para onde o link do e-mail de definição de senha leva depois (o login da web). */
  readonly redirectUri?: string;
  /** Client que aparece no e-mail e recebe o redirecionamento. */
  readonly emailClientId?: string;
  /** Validade do link do e-mail, em segundos (padrão 72 h). */
  readonly emailLifespan: number;

  constructor() {
    const e = process.env;
    this.baseUrl = (e.KEYCLOAK_AUTH_SERVER_URL ?? '').replace(/\/+$/, '');
    this.realm = e.KEYCLOAK_REALM ?? '';
    this.clientId = e.KEYCLOAK_ADMIN_CLIENT_ID || undefined;
    this.clientSecret = e.KEYCLOAK_ADMIN_CLIENT_SECRET || undefined;
    const mode = e.ACCESS_DIRECTORY_MODE || 'organization';
    if (mode !== 'organization' && mode !== 'realm') throw new Error('ACCESS_DIRECTORY_MODE deve ser "organization" ou "realm"');
    this.mode = mode;
    this.redirectUri = e.ACCESS_INVITE_REDIRECT_URI || undefined;
    this.emailClientId = e.ACCESS_INVITE_CLIENT_ID || (this.redirectUri ? 'fixer-web' : undefined);
    this.emailLifespan = Number(e.ACCESS_INVITE_LIFESPAN_SECONDS) > 0 ? Number(e.ACCESS_INVITE_LIFESPAN_SECONDS) : 72 * 3600;
  }

  get enabled(): boolean {
    return Boolean(this.baseUrl && this.realm && this.clientId && this.clientSecret);
  }
}
