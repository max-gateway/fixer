import { IBS_CBS_TRANSITION, type TransitionPeriod } from '../data/ibs-cbs-transition.js';

/** Período da transição IBS/CBS que cobre a data (AAAA-MM-DD); null antes de 2026. */
export function transitionFor(asOf: string): TransitionPeriod | null {
  return IBS_CBS_TRANSITION.find((p) => asOf >= p.from && asOf <= p.to) ?? null;
}

/**
 * Peso do regime antigo em uma data: o que ainda existe de PIS/Cofins e de ICMS. Serve para a precificação decidir
 * se pode usar o cálculo atual (monofásico, ST) ou se já está na fase em que só o novo regime vale.
 */
export function legacyTaxes(asOf: string): { pisCofins: boolean; icmsRemainingPct: string } | null {
  const p = transitionFor(asOf);
  if (!p) return null;
  const remaining = 100 - Number(p.icmsReductionPct);
  return { pisCofins: p.pisCofinsInForce, icmsRemainingPct: String(remaining) };
}
