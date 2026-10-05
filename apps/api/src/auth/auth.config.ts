import { Injectable } from '@nestjs/common';

/**
 * Config do Keycloak do tenant (vem do ConfigMap do chart fixer-tenant).
 * Falha no boot se faltar algo: subir sem auth configurada deixaria a API
 * recusando tudo (ou, pior, a tentação de afrouxar o guard).
 */
@Injectable()
export class AuthConfig {
  readonly issuer: string;
  readonly jwksUrl: URL;

  constructor() {
    const base = required('KEYCLOAK_AUTH_SERVER_URL').replace(/\/+$/, '');
    const realm = required('KEYCLOAK_REALM');
    this.issuer = `${base}/realms/${realm}`;
    this.jwksUrl = new URL(`${this.issuer}/protocol/openid-connect/certs`);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} é obrigatória`);
  return value;
}
