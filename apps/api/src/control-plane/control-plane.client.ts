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
