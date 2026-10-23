import { ISS_LC116_META, ISS_LIMITS, ISS_PLACE_RULES, LC116_ITEMS, type IssPlace, type IssPlaceRule, type Lc116Item } from '../data/iss-lc116.js';
import { inForce } from './types.js';

// ISS (LC 116/2003): subitem da lista, local de incidência e conferência da alíquota municipal contra os limites da lei. A alíquota
// do município não está aqui (lei municipal).

const norm = (code: string) => {
  const m = /^(\d{1,2})\.(\d{2})$/.exec(code.trim());
  return m ? `${Number(m[1])}.${m[2]}` : null;
};

/** Subitem da lista ("14.01" ou "1401" não: precisa do ponto). null se não existe. */
export function lc116Item(code: string): Lc116Item | null {
  const c = norm(code);
  return c ? (LC116_ITEMS.find((i) => i.code === c) ?? null) : null;
}

export interface IssPlaceResult {
  place: IssPlace;
  /** Regra do art. 3º que decidiu; null = regra geral (estabelecimento prestador). */
  rule: IssPlaceRule | null;
}

/** Local onde o ISS é devido para o subitem, pelo art. 3º (a exceção de fato, como serviço do exterior, é de quem chama). */
export function issPlace(code: string): IssPlaceResult | null {
  const c = norm(code);
  if (!c) return null;
  const group = c.split('.')[0]!;
  const rule = ISS_PLACE_RULES.find((r) => r.items.some((it) => it === c || it === group) && !r.except?.includes(c));
  return { place: rule?.place ?? 'PRESTADOR', rule: rule ?? null };
}

export type IssRateStatus = 'OK' | 'ABAIXO_DO_MINIMO' | 'ACIMA_DO_MAXIMO' | 'SUBITEM_INEXISTENTE' | 'RATE_INVALIDA' | 'FORA_DE_VIGENCIA';

/**
 * A alíquota de ISS que o município aplica ao subitem respeita a lei? Máximo 5% (art. 8º, II) e mínimo 2% (art. 8º-A), exceto os
 * subitens que a lei libera do mínimo (7.02, 7.05 e 16.01). Vale até 2032-12-31 (LC 116 revogada em 2033).
 */
export function issRateCheck(ratePct: string, code: string, asOf: string): IssRateStatus {
  if (!inForce(ISS_LC116_META, asOf)) return 'FORA_DE_VIGENCIA';
  const c = norm(code);
  if (!c || !lc116Item(c)) return 'SUBITEM_INEXISTENTE';
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(ratePct.trim());
  if (!m) return 'RATE_INVALIDA';
  const scaled = BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0') || '0');
  if (scaled > BigInt(ISS_LIMITS.maxPct.replace('.', '')) * 100n) return 'ACIMA_DO_MAXIMO';
  if (scaled < BigInt(ISS_LIMITS.minPct.replace('.', '')) * 100n && !ISS_LIMITS.belowMinAllowed.includes(c)) return 'ABAIXO_DO_MINIMO';
  return 'OK';
}
