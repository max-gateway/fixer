// Entradas da peça no estoque com a fotografia de cada lançamento (GET /parts/:id/entries; docs/specs/stock-entry-snapshot.md).
// O `context` é o que a API gravou no instante do lançamento; aqui só os campos que a tela usa.

import type { CostComponent } from './invoice-cost';
import type { PricingRowView } from './pricing';

export type EntryContext = {
  document?: { number: number | null; series: number | null; issuedAt: string | null; issuer: { name: string; uf: string | null } };
  stock?: { quantity: string; before: { costPrice: string | null; avgCost: string | null }; after: { costPrice: string | null; avgCost: string | null } };
  cost?: { unit: string | null; regime: string; components: (Omit<CostComponent, 'code'> & { code: string })[] };
  price?: {
    outcome: 'APPLIED' | 'UNCHANGED' | 'NOT_REQUESTED' | 'LOCKED';
    before: string | null;
    after: string | null;
    suggested: string | null;
    marginPct: string | null;
    rule: { method: 'MARGIN' | 'MARKUP'; value: string; overheadPct: string; minMarginPct: string } | null;
  };
  saleTax?: { pct: string | null; confidence: 'CONFIRMADO' | 'ESTIMADO' | 'DEFINIDO' } | null;
  engines?: { taxRulesVersion: string };
  posted?: { at: string };
};

export type EntryView = {
  id: string;
  at: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
  avgCostAfter: string;
  sellPriceAfter: string;
  priceChanged: boolean;
  taxRulesVersion: string;
  schemaVersion: number;
  /** O hash recalculado bate com o gravado: o registro é o original. */
  intact: boolean;
  context: EntryContext;
};

export const OUTCOME_LABEL: Record<NonNullable<EntryContext['price']>['outcome'], string> = {
  APPLIED: 'preço alterado',
  UNCHANGED: 'preço mantido',
  NOT_REQUESTED: 'lançada sem precificar',
  LOCKED: 'preço travado (manual)',
};

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const pctText = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const ruleText = (r: { method: 'MARGIN' | 'MARKUP'; value: string }) => `${r.method === 'MARGIN' ? 'margem' : 'markup'} ${pctText(Number(r.value))}`;

/**
 * "O que mudou desde então" (UI §6.8): compara a fotografia do lançamento com o cálculo de hoje do mesmo item e diz, em
 * português, só o que difere. Explica por que a sugestão de hoje não é a de antes.
 */
export function changesSince(entry: EntryContext, now: Pick<PricingRowView, 'cost' | 'rule' | 'saleTax'>): string[] {
  const out: string[] = [];
  const thenRule = entry.price?.rule ?? null;
  const nowRule = now.rule;
  if (thenRule && nowRule) {
    if (thenRule.method !== nowRule.method || Number(thenRule.value) !== Number(nowRule.value)) out.push(`regra de preço: ${ruleText(thenRule)} → ${ruleText(nowRule)}`);
    if (Number(thenRule.overheadPct) !== Number(nowRule.overheadPct)) out.push(`despesas na regra: ${pctText(Number(thenRule.overheadPct))} → ${pctText(Number(nowRule.overheadPct))}`);
    if (Number(thenRule.minMarginPct) !== Number(nowRule.minMarginPct)) out.push(`margem mínima: ${pctText(Number(thenRule.minMarginPct))} → ${pctText(Number(nowRule.minMarginPct))}`);
  } else if (!thenRule && nowRule) out.push(`regra de preço criada: ${ruleText(nowRule)}`);
  else if (thenRule && !nowRule) out.push('a regra de preço foi removida');

  const thenTax = num(entry.saleTax?.pct);
  const nowTax = num(now.saleTax.pct);
  if (thenTax !== nowTax) out.push(`imposto sobre a venda: ${thenTax === null ? 'sem cálculo' : pctText(thenTax)} → ${nowTax === null ? 'sem cálculo' : pctText(nowTax)}`);
  const thenConf = entry.saleTax?.confidence;
  if (thenConf && thenConf !== now.saleTax.confidence) out.push(`confiança do imposto: ${thenConf.toLowerCase()} → ${now.saleTax.confidence.toLowerCase()}`);

  const thenCost = num(entry.cost?.unit);
  const nowCost = num(now.cost);
  if (thenCost !== null && nowCost !== null && Math.abs(thenCost - nowCost) >= 0.005) {
    out.push(`custo desta compra: ${thenCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} → ${nowCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  }
  return out;
}

/** "De cada R$ 100 do preço": custo, imposto, despesas e o que sobra (negativo = prejuízo), em % do preço. */
export function priceShares(price: number, cost: number, taxPct: number, overheadPct: number) {
  if (price <= 0) return null;
  const costPct = (cost / price) * 100;
  return { cost: costPct, tax: taxPct, overhead: overheadPct, margin: 100 - costPct - taxPct - overheadPct };
}

/** Preço em que a venda só cobre custo, imposto e despesas (margem zero); null se não há preço possível. */
export const breakEvenPrice = (cost: number, taxPct: number, overheadPct: number, marginPct = 0) => {
  const room = 100 - taxPct - overheadPct - marginPct;
  return room > 0 ? (cost * 100) / room : null;
};
