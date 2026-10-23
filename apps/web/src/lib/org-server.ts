import { cookies } from 'next/headers';
import { cache } from 'react';
import { getAccessToken } from '@/auth';
import { isUuid, ORG_COOKIE, orgIdsFromToken, pickActiveOrg, type ActiveOrg } from './org';

export type OrgSummary = { id: string; name: string | null; slug: string | null };

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const TTL_MS = 30_000;
const memo = new Map<string, { at: number; list: OrgSummary[] }>();
const subOf = (token: string): string | null => {
  try {
    return (JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
};

/**
 * Oficinas do usuário, perguntando à API (que soma o claim do token com a participação registrada pelo control plane).
 * NÃO se confia só no claim do token: o Keycloak 26.0 o omite ao acaso para quem está em várias oficinas.
 * Memoizado por usuário por 30 s (e por requisição, via `cache`). Se a API estiver fora, cai para o claim.
 */
export const listOrganizations = cache(async (): Promise<OrgSummary[]> => {
  const token = await getAccessToken();
  if (!token) return [];
  const sub = subOf(token);
  const hit = sub ? memo.get(sub) : undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list;
  try {
    const res = await fetch(`${apiUrl()}/me/organizations`, { cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
    if (res.ok) {
      const list = ((await res.json()) as { organizations: OrgSummary[] }).organizations;
      if (sub) memo.set(sub, { at: Date.now(), list });
      return list;
    }
  } catch {
    // API indisponível: o seletor ainda funciona com o que o token traz
  }
  // Só para o seletor: o claim é uma pista e nunca concede nada. A API confere a participação a cada chamada (404 se não for da pessoa).
  return orgIdsFromToken(token).map((id) => ({ id, name: null, slug: null }));
});

/** Oficinas do usuário e qual está ativa (o cookie só vale se a oficina ainda for dele: um id adulterado não passa). */
export async function getOrgContext(): Promise<ActiveOrg & { orgs: string[] }> {
  const orgs = (await listOrganizations()).map((o) => o.id);
  const saved = (await cookies()).get(ORG_COOKIE)?.value;
  return { orgs, ...pickActiveOrg(orgs, saved) };
}

/**
 * Cabeçalho para as chamadas à API. Com a escolha já gravada no cookie, é só repassá-la (a API confere contra o usuário a cada
 * chamada, então não há consulta extra); sem cookie, usa a única oficina do usuário, ou nada (legado / ainda sem escolha).
 */
export async function orgHeader(): Promise<Record<string, string>> {
  const saved = (await cookies()).get(ORG_COOKIE)?.value;
  if (isUuid(saved)) return { 'x-org-id': saved.toLowerCase() };
  const { active } = await getOrgContext();
  return active ? { 'x-org-id': active } : {};
}

/** Nome para exibir: razão social, depois o slug, depois o início do id. */
export const orgLabel = (o: OrgSummary) => o.name ?? o.slug ?? `Oficina ${o.id.slice(0, 8)}`;
