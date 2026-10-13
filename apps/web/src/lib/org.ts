// Escolha da organização (oficina) ativa. Lógica PURA (sem Next): o servidor lê o token e o cookie e chama estas funções.
// A API é quem decide de verdade: o token manda e o cabeçalho X-Org-Id só escolhe entre as organizações do próprio token.

/** Cookie com a organização escolhida (só o id; httpOnly, definido pela rota de seleção). */
export const ORG_COOKIE = 'fixer_org';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

/**
 * Organizações do access token (claim do Keycloak Organizations): lista de UUIDs, ou objeto `{ alias: { id } }`.
 * Só LÊ o payload para decidir a interface; a assinatura é validada pela API a cada chamada.
 */
export function orgIdsFromToken(accessToken: string | null | undefined, claim = 'organization'): string[] {
  const part = accessToken?.split('.')[1];
  if (!part) return [];
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return [];
  }
  const value = payload[claim];
  const out = new Set<string>();
  const add = (v: unknown) => isUuid(v) && out.add(v.toLowerCase());
  if (Array.isArray(value)) value.forEach(add);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (isUuid(k)) add(k);
      else if (v && typeof v === 'object') add((v as { id?: unknown }).id);
    }
  }
  return [...out];
}

export interface ActiveOrg {
  /** Organização a enviar no X-Org-Id; `null` quando não há o que enviar (token legado) ou ainda é preciso escolher. */
  active: string | null;
  /** O usuário participa de mais de uma oficina e ainda não escolheu (ou a escolha guardada não vale mais). */
  needsChoice: boolean;
}

export function pickActiveOrg(orgs: string[], saved?: string | null): ActiveOrg {
  if (orgs.length === 0) return { active: null, needsChoice: false }; // token sem organizações: instalação legada
  if (orgs.length === 1) return { active: orgs[0]!, needsChoice: false };
  const wanted = saved?.toLowerCase();
  if (wanted && orgs.includes(wanted)) return { active: wanted, needsChoice: false };
  return { active: null, needsChoice: true };
}
