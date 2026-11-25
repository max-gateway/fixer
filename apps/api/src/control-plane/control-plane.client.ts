import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ControlPlaneConfig } from './control-plane.config.js';

export interface LicenseClaims {
  sub: string; // organização
  product: string;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled' | 'expired';
  mode: 'full' | 'readonly' | 'none';
  ver: number;
  trialEndsAt: string | null;
  readonlyUntil: string | null;
  ent: Record<string, { kind: string; value: unknown }>;
  exp: number;
}

/** Busca o snapshot de licença da organização e o valida pelo JWKS do control plane (assinatura, emissor, validade). */
@Injectable()
export class ControlPlaneClient {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly cfg: ControlPlaneConfig) {}

  /** `null` quando a organização não tem assinatura neste produto (404). Lança em qualquer outra falha. */
  async snapshot(orgId: string): Promise<LicenseClaims | null> {
    const { url, apiKey, product } = this.cfg;
    if (!url || !apiKey) throw new Error('Control plane não configurado');
    const res = await fetch(`${url}/v1/orgs/${encodeURIComponent(orgId)}/entitlements?product=${encodeURIComponent(product)}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Control plane respondeu ${res.status} ao buscar a licença`);
    const { token } = (await res.json()) as { token: string };

    this.jwks ??= createRemoteJWKSet(new URL(`${url}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, this.jwks, { issuer: this.cfg.issuer, algorithms: ['EdDSA'] });
    if (payload.sub !== orgId || payload.product !== product) throw new Error('Snapshot de licença de outra organização ou produto');
    return payload as unknown as LicenseClaims;
  }

  /** Membros da organização como o control plane os vê (`GET /v1/orgs/{org}/members`). `platformRoles` é o papel EFETIVO (atribuído ou padrão). */
  async listMembers(orgId: string): Promise<{ userId: string; email: string; role: string; status: string; platformRoles: string[] }[] | null> {
    const { url, apiKey } = this.cfg;
    if (!url || !apiKey) throw new Error('Control plane não configurado');
    const res = await fetch(`${url}/v1/orgs/${encodeURIComponent(orgId)}/members`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000) });
    // 404: a organização não assina este produto (a chave é presa ao produto). Não é erro de quem pergunta.
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Control plane respondeu ${res.status} ao listar os membros`);
    return ((await res.json()) as { members: { userId: string; email: string; role: string; status: string; platformRoles: string[] }[] }).members;
  }

  /**
   * Adiciona (ou reativa) um membro da organização. A conta no Keycloak NASCE DEPOIS, numa fila do control plane (`identity: 'pending'`): o `sub` só chega no
   * evento `identity.member_ready`, que também manda o e-mail de definição de senha. Idempotente por e-mail. `null` quando a organização não assina este produto.
   */
  async addMember(orgId: string, input: { email: string; name: string; role?: 'admin' | 'member' | 'billing' }): Promise<{ userId: string; identity: string } | null> {
    const { url, apiKey } = this.cfg;
    if (!url || !apiKey) throw new Error('Control plane não configurado');
    const res = await fetch(`${url}/v1/orgs/${encodeURIComponent(orgId)}/members`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: input.email, name: input.name, role: input.role ?? 'member' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Control plane respondeu ${res.status} ao adicionar o membro`);
    return (await res.json()) as { userId: string; identity: string };
  }

  /** Remove o membro da organização (o vínculo fica desativado no control plane). `false` quando a organização ou o membro não existem para este produto; lança se for o dono (422). */
  async removeMember(orgId: string, userId: string): Promise<boolean> {
    const { url, apiKey } = this.cfg;
    if (!url || !apiKey) throw new Error('Control plane não configurado');
    const res = await fetch(`${url}/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 403) return false;
    if (res.status === 422) throw new Error('O dono da organização não pode ser removido');
    if (!res.ok) throw new Error(`Control plane respondeu ${res.status} ao remover o membro`);
    return true;
  }

  /** Reenvia o link de definição de senha de um membro ativo. `null` quando o membro não existe nesta organização; `false` quando o Keycloak ou o SMTP não permitiram. */
  async resendSetupEmail(orgId: string, userId: string): Promise<boolean | null> {
    const { url, apiKey } = this.cfg;
    if (!url || !apiKey) throw new Error('Control plane não configurado');
    const res = await fetch(`${url}/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/resend-setup-email`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Control plane respondeu ${res.status} ao reenviar o e-mail`);
    return ((await res.json()) as { sent: boolean }).sent;
  }

  /** Atribui os papéis de plataforma de um membro (substitui; idempotente). `false` quando a organização ou o membro não existem para este produto. */
  async setPlatformRoles(orgId: string, userId: string, roles: string[]): Promise<boolean> {
    const { url, apiKey } = this.cfg;
    if (!url || !apiKey) throw new Error('Control plane não configurado');
    const res = await fetch(`${url}/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/platform-roles`, {
      method: 'PUT',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ roles }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 403) return false;
    if (!res.ok) throw new Error(`Control plane respondeu ${res.status} ao atribuir papéis de plataforma`);
    return true;
  }

  /**
   * Informa o total do período até agora (idempotente: o último valor vence). `false` quando o control plane não conhece a
   * assinatura (404): não é erro do envio. Qualquer outra falha lança.
   */
  async reportUsage(orgId: string, metric: string, quantity: number): Promise<boolean> {
    const { url, apiKey, product } = this.cfg;
    if (!url || !apiKey) throw new Error('Control plane não configurado');
    const res = await fetch(`${url}/v1/usage`, {
      method: 'PUT',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: orgId, product, metric, quantity }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`Control plane respondeu ${res.status} ao informar o uso`);
    return true;
  }
}
