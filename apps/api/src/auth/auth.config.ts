import { Injectable } from '@nestjs/common';

/**
 * Config do Keycloak (vem do ConfigMap do chart). Falha no boot se faltar algo: subir sem auth configurada
 * deixaria a API recusando tudo (ou, pior, a tentação de afrouxar o guard).
 */
@Injectable()
export class AuthConfig {
  readonly issuer: string;
  readonly jwksUrl: URL;
  /** Claim do token com as organizações do usuário (lista de UUIDs do control plane). */
  readonly orgsClaim: string;
  /**
   * Organização das instalações legadas (um banco por oficina), cujo token não traz o claim de organizações.
   * Em produção multi-tenant fica vazio: token sem organização é recusado.
   */
  readonly defaultOrgId?: string;

  constructor() {
    const base = required('KEYCLOAK_AUTH_SERVER_URL').replace(/\/+$/, '');
    const realm = required('KEYCLOAK_REALM');
    this.issuer = `${base}/realms/${realm}`;
    this.jwksUrl = new URL(`${this.issuer}/protocol/openid-connect/certs`);
    // `organization` é o claim do recurso Organizations do Keycloak 26 (lista de aliases = UUIDs do control plane).
    this.orgsClaim = process.env.AUTH_ORGS_CLAIM || 'organization';
    const def = process.env.DEFAULT_ORG_ID;
    if (def && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(def)) {
      throw new Error('DEFAULT_ORG_ID deve ser um UUID');
    }
    this.defaultOrgId = def || undefined;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} é obrigatória`);
  return value;
}
