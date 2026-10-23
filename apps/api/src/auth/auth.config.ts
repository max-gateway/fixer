import { Injectable } from '@nestjs/common';

/**
 * Config do Keycloak (vem do ConfigMap do chart). Falha no boot se faltar algo: subir sem auth configurada
 * deixaria a API recusando tudo (ou, pior, a tentação de afrouxar o guard).
 */
@Injectable()
export class AuthConfig {
  readonly issuer: string;
  readonly jwksUrl: URL;
  /**
   * Audiência desta API (`aud` do token). Obrigatória: sem ela, um token emitido para QUALQUER outro client do realm seria aceito.
   * O client web precisa de um audience mapper que a inclua (infra/dev/realm-fixer-dev.json).
   */
  readonly audience: string;

  constructor() {
    const base = required('KEYCLOAK_AUTH_SERVER_URL').replace(/\/+$/, '');
    const realm = required('KEYCLOAK_REALM');
    this.issuer = `${base}/realms/${realm}`;
    this.jwksUrl = new URL(`${this.issuer}/protocol/openid-connect/certs`);
    this.audience = required('AUTH_AUDIENCE');
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} é obrigatória`);
  return value;
}
