import { Injectable } from '@nestjs/common';

/**
 * Config do Keycloak (vem do ConfigMap do chart). Falha no boot se faltar algo: subir sem auth configurada
 * deixaria a API recusando tudo (ou, pior, a tentação de afrouxar o guard).
 * A validação do token e a resolução da organização são do `@max-gateway/auth` (spec da plataforma §7.2): aqui só se
 * configura emissor, audiência e vida máxima do token.
 */
@Injectable()
export class AuthConfig {
  readonly issuer: string;
  readonly jwksUrl: URL;
  /** `aud` que o token precisa trazer (audience mapper no client do app). */
  readonly audience: string;
  /** Vida máxima aceita do token (`exp − iat`); 900 s é o contrato da plataforma. */
  readonly maxTokenLifetimeSec: number;

  constructor() {
    const base = required('KEYCLOAK_AUTH_SERVER_URL').replace(/\/+$/, '');
    const realm = required('KEYCLOAK_REALM');
    this.issuer = `${base}/realms/${realm}`;
    this.jwksUrl = new URL(`${this.issuer}/protocol/openid-connect/certs`);
    this.audience = process.env.AUTH_AUDIENCE || 'fixer-api';
    this.maxTokenLifetimeSec = Number(process.env.AUTH_MAX_TOKEN_LIFETIME_SEC) || 900;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} é obrigatória`);
  return value;
}
