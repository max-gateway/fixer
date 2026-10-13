import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { JWTPayload } from 'jose';
import { TenantContext } from './tenant-context.js';

export interface OrgResolution {
  /** Nome do claim do token com as organizações do usuário. */
  claim: string;
  /** Organização usada quando o token não traz o claim (instalações legadas: uma oficina por instância). */
  defaultOrgId?: string;
}

/**
 * Lê as organizações do claim. Formatos do Keycloak 26: lista de aliases (o padrão), ou objeto `{ alias: { id } }`.
 * O alias é o UUID da organização no control plane; o `id` do objeto é o id INTERNO do Keycloak e só vale se a chave não for um UUID.
 */
export function orgsFromClaim(value: unknown): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => typeof v === 'string' && TenantContext.isUuid(v) && out.add(v.toLowerCase());
  if (Array.isArray(value)) value.forEach(add);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (TenantContext.isUuid(k)) add(k);
      else if (v && typeof v === 'object') add((v as { id?: unknown }).id);
    }
  }
  return [...out];
}

/**
 * Decide a organização da requisição. A organização é SEMPRE confirmada pelo token: o cabeçalho `X-Org-Id` só escolhe
 * entre as organizações do próprio usuário (quem participa de várias), nunca concede acesso.
 */
export function resolveOrg(payload: JWTPayload, header: string | undefined, cfg: OrgResolution, memberOf: string[] = []): string {
  // Claim (atalho) + participação conhecida pelo Fixer (autoridade): o Keycloak 26.0 omite o claim ao acaso para quem está em várias organizações.
  const orgs = [...new Set([...orgsFromClaim(payload[cfg.claim]), ...memberOf.map((o) => o.toLowerCase())])];
  const wanted = header?.trim().toLowerCase();

  if (orgs.length === 0) {
    if (cfg.defaultOrgId) return cfg.defaultOrgId.toLowerCase();
    throw new ForbiddenException('Token sem organização (o login deve pedir o escopo organization:*)');
  }
  if (wanted) {
    if (!orgs.includes(wanted)) throw new ForbiddenException('Você não participa desta organização');
    return wanted;
  }
  if (orgs.length === 1) return orgs[0]!;
  throw new BadRequestException('Informe a organização no cabeçalho X-Org-Id');
}
