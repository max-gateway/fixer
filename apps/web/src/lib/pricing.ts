// Precificação a partir da nota de compra (docs/specs/pricing.md). Decimais chegam como string no JSON.
// A API é a autoridade: aqui só há a conta de exibição (margem de um preço digitado) e os textos.

import type { CostComponent } from './invoice-cost';

export type PriceFlag =
  | 'NO_RULE'
  | 'LOCKED'
  | 'NO_COST'
  | 'NOT_RESALE'
  | 'TAX_UNAVAILABLE'
  | 'TAX_UNCONFIRMED'
  | 'BELOW_COST'
  | 'BELOW_COST_AFTER_TAX'
  | 'BELOW_MIN_MARGIN'
  | 'BELOW_BREAK_EVEN'
  | 'BIG_JUMP'
  | 'COST_SPIKE'
  | 'PRICE_DOWN';

export type SaleTaxView = {
  pct: string | null;
  confidence: 'CONFIRMADO' | 'ESTIMADO' | 'DEFINIDO';
  unavailable: 'REGIME_NAO_SUPORTADO' | 'SEM_ALIQUOTA' | 'REPARTICAO_FALTANDO' | 'RBT12_FORA_DO_SIMPLES' | 'REGRA_FORA_DE_VIGENCIA' | 'REFORMA_SEM_ALIQUOTA' | null;
  components: { code: string; pct: string; reason: string }[];
};

export type RuleScope = 'PART' | 'NCM' | 'SUPPLIER' | 'DEFAULT';
export type RuleView = { method: 'MARGIN' | 'MARKUP'; value: string; overheadPct: string; rounding: string; minMarginPct: string; maxJumpPct: string };

export const RULE_SCOPE_LABEL: Record<RuleScope, string> = {
  PART: 'regra desta peça',
  NCM: 'regra deste NCM',
  SUPPLIER: 'regra deste fornecedor',
  DEFAULT: 'regra padrão',
};

export type PriceHistoryEntry = {
  at: string;
  source: 'INVOICE' | 'MANUAL' | 'AUTO' | 'REVERSAL';
  costBefore: string | null;
  costAfter: string;
  sellBefore: string | null;
  sellAfter: string;
  marginAfter: string | null;
  saleTaxPct: string | null;
  taxRulesVersion: string | null;
};

export type PricingRowView = {
  itemNumber: number;
  partId: string;
  ruleScope: RuleScope | null;
  rule: RuleView | null;
  sku: string;
  name: string;
  stockQty: string;
  cost: string | null;
  /** Componentes do custo da linha (livro de custo da API). */
  costComponents?: CostComponent[];
  previousCost: string | null;
  currentPrice: string | null;
  suggested: string | null;
  draft: string | null;
  proposed: string | null;
  marginPct: string | null;
  markupPct: string | null;
  saleTax: SaleTaxView;
  /** Divergências entre o XML do fornecedor e as tabelas de regra, para conferir. */
  taxNotes: { code: string; text: string }[];
  flags: PriceFlag[];
  blocking: PriceFlag[];
  ack: boolean;
  error: string | null;
  locked: boolean;
  /** Despesas que o preço usou: do perfil de custos (estrutura + venda + extra por unidade) ou da regra. */
  overhead?: { source: 'PROFILE' | 'RULE'; variablePct: string; fixedPct: string; extraUnitCost: string };
};

export type CostProfileStatus =
  | { status: 'OK'; version: number; channel: string; fixedPct: string; variablePct: string; financialPct: string; extraUnitCost: string; confidence: 'CONFIRMADO' | 'ESTIMADO' }
  | { status: 'OFF' | 'NONE' | 'UNAVAILABLE' };

export type PricingPlanView = {
  rulesVersion: string;
  regime: 'SIMPLES' | 'PRESUMIDO' | 'REAL';
  hasRule: boolean;
  rule: RuleView | null;
  requireTaxConfirmation: boolean;
  /** O que falta, no cadastro, para o imposto desta nota sair confirmado (a mesma conta da tela de configuração). */
  taxReadiness: {
    ready: boolean;
    supported: boolean;
    regime: 'SIMPLES' | 'PRESUMIDO' | 'REAL';
    summary: string;
    missing: { id: 'regime' | 'dados' | 'perfil' | 'tabela' | 'tabela-monofasico'; label: string; detail: string; tableId: string | null }[];
  };
  rows: PricingRowView[];
  /** Perfil de custos usado nas despesas do preço (ou por que não). */
  costProfile?: CostProfileStatus;
};

export type FlagInfo = { label: string; hint: string; tone: 'danger' | 'warning' | 'info' };

/** Cada alerta em linguagem de balcão, com o que fazer. A cor nunca é o único sinal: todo chip tem texto. */
export const FLAG_INFO: Record<PriceFlag, FlagInfo> = {
  NO_RULE: { label: 'Sem regra', hint: 'Defina a regra de preço para receber sugestões.', tone: 'info' },
  LOCKED: { label: 'Preço travado', hint: 'Esta peça tem preço manual: a nota não sugere nem altera.', tone: 'info' },
  NO_COST: { label: 'Sem custo', hint: 'Item sem quantidade: não há custo para calcular.', tone: 'info' },
  NOT_RESALE: { label: 'Não é revenda', hint: 'A nota não parece compra para revenda (bonificação, conserto, consignação...). Defina o preço à mão, se for o caso.', tone: 'warning' },
  TAX_UNAVAILABLE: { label: 'Imposto não calculado', hint: 'Faltam os percentuais do contador (alíquota efetiva e repartição) ou o regime não é suportado ainda.', tone: 'warning' },
  TAX_UNCONFIRMED: { label: 'Imposto não confirmado', hint: 'O enquadramento (ST, monofásico) desta peça ainda não foi confirmado.', tone: 'warning' },
  BELOW_COST: { label: 'Abaixo do custo', hint: 'O preço é menor que o custo: prejuízo certo. Não dá para lançar assim.', tone: 'danger' },
  BELOW_COST_AFTER_TAX: { label: 'Prejuízo depois do imposto', hint: 'Vende por mais que o custo, mas depois do imposto e das despesas não cobre o custo.', tone: 'danger' },
  BELOW_BREAK_EVEN: { label: 'Não cobre a estrutura', hint: 'Cobre o custo, o imposto e as despesas de venda, mas não a parte das despesas fixas da oficina. Marque "estou ciente" para seguir.', tone: 'warning' },
  BELOW_MIN_MARGIN: { label: 'Margem abaixo do mínimo', hint: 'A margem líquida é menor que o mínimo da regra. Marque "estou ciente" para seguir.', tone: 'warning' },
  BIG_JUMP: { label: 'Mudança grande', hint: 'O preço muda mais que o limite da regra. Marque "estou ciente" para seguir.', tone: 'warning' },
  COST_SPIKE: { label: 'Custo subiu muito', hint: 'O custo desta compra é bem maior que o anterior. Confira a nota.', tone: 'warning' },
  PRICE_DOWN: { label: 'Preço baixa', hint: 'O novo preço é menor que o atual.', tone: 'info' },
};

/** Alertas que o usuário pode liberar com "estou ciente" (os demais ou são avisos ou não têm liberação). */
export const ACKABLE: readonly PriceFlag[] = ['BELOW_MIN_MARGIN', 'BELOW_BREAK_EVEN', 'BIG_JUMP', 'TAX_UNCONFIRMED'];

/**
 * Despesas efetivas de uma linha, em % do preço e R$ por unidade: as do perfil de custos quando a API as aplicou, senão o
 * `overheadPct` da regra (plano antigo ou sem perfil). `priceCost` = custo + extra por unidade, base do preço e da margem.
 */
export function rowExpenses(r: Pick<PricingRowView, 'overhead' | 'rule' | 'cost'>, planRule: RuleView | null) {
  if (r.overhead) {
    const extra = Number(r.overhead.extraUnitCost);
    return { source: r.overhead.source, variable: Number(r.overhead.variablePct), fixed: Number(r.overhead.fixedPct), extra, priceCost: Number(r.cost ?? 0) + extra };
  }
  return { source: 'RULE' as const, variable: Number((r.rule ?? planRule)?.overheadPct ?? 0), fixed: 0, extra: 0, priceCost: Number(r.cost ?? 0) };
}

/** "43,90", "43.90" e "1.234,56" viram número; texto vazio ou inválido vira null. */
export function parsePrice(text: string): number | null {
  const t = text.trim().replace(/^R\$\s*/, '');
  if (t === '') return null;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Margem líquida de um preço digitado (só exibição; a API recalcula na hora de salvar e de lançar). */
export function marginOf(cost: number, price: number, taxPct: number, overheadPct: number): number {
  if (price <= 0) return 0;
  return (((price * (100 - taxPct - overheadPct)) / 100 - cost) / price) * 100;
}

export const pct1 = (v: number | string) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const brl4 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const moneyCost = (v: string | number) => brl4.format(Number(v));

/** Variação percentual entre dois valores (null quando não há base de comparação). */
export function delta(from: string | null, to: string | null): number | null {
  if (from === null || to === null || Number(from) <= 0) return null;
  return ((Number(to) - Number(from)) / Number(from)) * 100;
}

export type Rounding = 'NONE' | 'CENTS_90' | 'CENTS_00' | 'MULTIPLE_5' | 'MULTIPLE_10';

/** Mesmo arredondamento da API (sempre para cima), só para prévias na tela. */
export function roundUp(price: number, mode: Rounding): number {
  // A API usa Decimal (exato); aqui o ponto flutuante pode deixar 160,00 como 160,0000000001 e subir um degrau à toa.
  const p = price - 1e-9;
  switch (mode) {
    case 'CENTS_90':
      return Math.max(0, Math.ceil(p - 0.9)) + 0.9;
    case 'CENTS_00':
      return Math.ceil(p);
    case 'MULTIPLE_5':
      return Math.ceil(p / 5) * 5;
    case 'MULTIPLE_10':
      return Math.ceil(p / 10) * 10;
    default:
      return Math.ceil(p * 100) / 100;
  }
}

/** Markup sobre o custo de um preço: (preço ÷ custo − 1), em %. É o markup que a tela mostra (inclui o imposto embutido). */
export function markupOf(cost: number, price: number): number {
  return cost > 0 ? (price / cost - 1) * 100 : 0;
}

/** Preço de um markup sobre o custo, arredondado para cima como a regra. Só prévia: a API recalcula ao salvar. */
export function priceFromMarkup(cost: number, markupPct: number, rounding: Rounding): number {
  return roundUp(cost * (1 + markupPct / 100), rounding);
}

/** Margem sobre a venda equivalente a um markup, sem imposto nem despesas (markup 100% = margem 50%). */
export const markupToMargin = (markupPct: number) => (markupPct / (100 + markupPct)) * 100;

/** Markup equivalente a uma margem sobre a venda, sem imposto nem despesas (margem 50% = markup 100%); infinito a partir de 100%. */
export const marginToMarkup = (marginPct: number) => (marginPct >= 100 ? Infinity : (marginPct / (100 - marginPct)) * 100);
