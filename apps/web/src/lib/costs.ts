// Despesas e perfil de custos (API /costs, que fala com o cost-engine da plataforma). Decimais chegam como string.

export type ExpenseKind = 'FIXED' | 'SALE_PCT' | 'PER_UNIT' | 'PER_ORDER' | 'PURCHASE' | 'FINANCIAL' | 'PROVISION';

export type CostExpense = {
  id: string;
  categoryCode: string;
  name: string;
  kind: ExpenseKind;
  amount: string | null;
  pct: string | null;
  recurrence: 'MONTHLY' | 'ANNUAL' | 'ONE_OFF_AMORTIZED' | 'PER_EVENT';
  amortizeMonths: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  allocations: { costCenter: string; pct: string }[];
  appliesTo: { channels?: string[]; paymentMethods?: string[] } | null;
  version: number;
};

export type CostCategory = { code: string; name: string; defaultKind: ExpenseKind };
export type CostCenterView = { code: string; name: string; kind: 'PRODUCTIVE' | 'SUPPORT'; allocation: 'REVENUE_PCT' | 'HOURLY' | null };
export type CostChannel = { code: string; name: string; costCenter: string };

export type ProfileChannel = { code: string; costCenter: string; allocation: 'REVENUE_PCT' | 'HOURLY' | null; fixedPct: string | null; variablePct: string; financialPct: string; warnings: string[] };
export type ProfileCenter = { code: string; fixedMonthly: string; revenueBase: string | null; monthsOfData: number; fixedPct: string | null; productiveHours: string | null; hourlyCost: string | null; warnings: string[] };
export type CostProfile = {
  version?: number;
  period: string;
  confidence: 'CONFIRMADO' | 'ESTIMADO';
  warnings: string[];
  centers: Record<string, ProfileCenter>;
  channels: Record<string, ProfileChannel>;
  publishedAt?: string;
};

export const PAYMENT_METHODS = [
  { code: 'PIX', label: 'PIX' },
  { code: 'DINHEIRO', label: 'Dinheiro' },
  { code: 'DEBITO', label: 'Débito' },
  { code: 'CREDITO_1X', label: 'Crédito à vista' },
  { code: 'CREDITO_PARCELADO', label: 'Crédito parcelado' },
] as const;
export type PaymentMethodCode = (typeof PAYMENT_METHODS)[number]['code'];

export type CostSettings = {
  paymentMix: Partial<Record<PaymentMethodCode, number>> | null;
  mechanics: number | null;
  hoursPerMechanic: number | null;
  partsRevenueGoal: number | null;
  lastSyncAt: string | null;
  lastPublishedVersion: number | null;
};

export type CostsOverview =
  | { enabled: false }
  | { enabled: true; cnpj: string; expenses: CostExpense[]; categories: CostCategory[]; channels: CostChannel[]; costCenters: CostCenterView[]; profile: CostProfile | null; settings: CostSettings };

export type DraftResult = { months: number; ordersCounted: number; actualsSent: number; profile: CostProfile; basedOnVersion: number | null; impact: { channel: string; beforePp: string | null; afterPp: string; deltaPp: string | null }[] };

/** Avisos do perfil em linguagem de balcão, com o que fazer. */
export const WARNING_TEXT: Record<string, string> = {
  BASE_CURTA: 'Menos de 3 meses de OS concluídas: a estrutura ainda é estimativa. Informe a meta de faturamento para usar como base.',
  ESTRUTURA_ACIMA_DO_FATURAMENTO: 'As despesas fixas passam de 40% do faturamento: confira os valores ou o faturamento.',
  SEM_BASE_DE_RATEIO: 'Falta base para dividir a estrutura: sem faturamento de peças ou sem horas da oficina.',
  OCUPACAO_PADRAO: 'Sem horas reais nas OS: o custo da hora supõe 75% das horas disponíveis vendidas.',
  MIX_DE_PAGAMENTO_AUSENTE: 'Sem o mix de pagamento: a taxa da maquininha foi aplicada a toda venda (pior caso).',
  ITENS_POR_PEDIDO_PADRAO: 'Sem pedidos registrados: despesa por pedido dividida por 1 item.',
  RATEIO_ADMINISTRATIVO_IGUAL: 'Sem faturamento para dividir a administração: dividida em partes iguais.',
  REALIZADO_ACIMA_DO_ORCADO: 'Alguma despesa foi paga acima do cadastrado: o rateio usou o valor pago.',
};

/** O tipo da despesa a partir da pergunta "como ela muda?" (UI §6.2). */
export const KIND_QUESTION: { kind: ExpenseKind; label: string; hint: string }[] = [
  { kind: 'FIXED', label: 'Valor fixo', hint: 'Aluguel, salários, contador: não muda com as vendas.' },
  { kind: 'SALE_PCT', label: '% de cada venda', hint: 'Taxa da maquininha, comissão.' },
  { kind: 'PER_UNIT', label: 'Valor por peça vendida', hint: 'Embalagem, etiqueta.' },
  { kind: 'PER_ORDER', label: 'Valor por pedido', hint: 'Tarifa fixa por venda.' },
];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const pctFmt = (v: string | number) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** Uma linha da lista: o valor e quando ele vale, em português. */
export function expenseSummary(e: Pick<CostExpense, 'kind' | 'amount' | 'pct' | 'recurrence' | 'amortizeMonths'>): string {
  if (e.kind === 'SALE_PCT' || e.kind === 'FINANCIAL') return `${pctFmt(e.pct ?? 0)} de cada venda`;
  if (e.kind === 'PER_UNIT') return `${brl.format(Number(e.amount ?? 0))} por peça`;
  if (e.kind === 'PER_ORDER') return `${brl.format(Number(e.amount ?? 0))} por pedido`;
  if (e.kind === 'PROVISION') return 'provisão';
  const v = brl.format(Number(e.amount ?? 0));
  if (e.recurrence === 'ANNUAL') return `${v} por ano (÷ 12)`;
  if (e.recurrence === 'ONE_OFF_AMORTIZED') return `${v} em ${e.amortizeMonths ?? 1} meses`;
  return `${v} por mês`;
}

/** Equivalente mensal de uma despesa fixa, para o total da lista (provisão e variáveis ficam fora). */
export function monthlyOf(e: Pick<CostExpense, 'kind' | 'amount' | 'recurrence' | 'amortizeMonths'>): number {
  if (e.kind !== 'FIXED') return 0;
  const a = Number(e.amount ?? 0);
  if (e.recurrence === 'ANNUAL') return a / 12;
  if (e.recurrence === 'ONE_OFF_AMORTIZED') return a / (e.amortizeMonths ?? 1);
  return a;
}

export type ExpenseForm = {
  kind: ExpenseKind;
  categoryCode: string;
  name: string;
  value: string;
  recurrence: 'MONTHLY' | 'ANNUAL' | 'ONE_OFF_AMORTIZED';
  amortizeMonths: string;
  costCenter: string;
  effectiveFrom: string;
  channels: string[];
  paymentMethods: string[];
};

/** "1.234,56" ou "1234.56" -> número; vazio ou inválido -> null. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Corpo do POST/PUT de despesa no formato do cost-engine (ele valida e devolve os detalhes). */
export function expenseBody(f: ExpenseForm) {
  const value = parseNumber(f.value);
  const isPct = f.kind === 'SALE_PCT' || f.kind === 'FINANCIAL';
  return {
    categoryCode: f.categoryCode,
    name: f.name.trim(),
    kind: f.kind,
    amount: isPct ? null : value,
    pct: isPct ? value : null,
    recurrence: f.kind === 'FIXED' ? f.recurrence : 'MONTHLY',
    amortizeMonths: f.kind === 'FIXED' && f.recurrence === 'ONE_OFF_AMORTIZED' ? Math.max(1, Math.round(parseNumber(f.amortizeMonths) ?? 1)) : null,
    effectiveFrom: f.effectiveFrom,
    effectiveTo: null,
    allocations: f.kind === 'FIXED' ? [{ costCenter: f.costCenter, pct: 100 }] : [],
    appliesTo: f.kind === 'FIXED' ? null : { ...(f.channels.length ? { channels: f.channels } : {}), ...(f.paymentMethods.length ? { paymentMethods: f.paymentMethods } : {}) },
    provision: null,
  };
}

export function formFromExpense(e: CostExpense): ExpenseForm {
  const isPct = e.kind === 'SALE_PCT' || e.kind === 'FINANCIAL';
  return {
    kind: e.kind,
    categoryCode: e.categoryCode,
    name: e.name,
    value: String(Number((isPct ? e.pct : e.amount) ?? 0)).replace('.', ','),
    recurrence: e.recurrence === 'ANNUAL' || e.recurrence === 'ONE_OFF_AMORTIZED' ? e.recurrence : 'MONTHLY',
    amortizeMonths: String(e.amortizeMonths ?? ''),
    costCenter: e.allocations[0]?.costCenter ?? 'PECAS',
    effectiveFrom: e.effectiveFrom,
    channels: e.appliesTo?.channels ?? [],
    paymentMethods: e.appliesTo?.paymentMethods ?? [],
  };
}

/** Soma do mix informado (a tela exige 100%). */
export const mixSum = (m: Partial<Record<string, number>>) => Object.values(m).reduce<number>((s, v) => s + (v ?? 0), 0);
