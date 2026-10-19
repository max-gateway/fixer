import { Prisma } from '@fixer/db';

// O que o Fixer manda ao motor de custos (platform cost-engine, docs/specs/cost-engine.md §14 fase 1). Funções puras: a
// agregação das OS por mês, as métricas por centro de custo do modelo "oficina" e a categoria de cada conta paga.

type D = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value | null | undefined): D => new Prisma.Decimal(v ?? 0);

/** Centros do modelo "oficina" no cost-engine. */
export const CENTER_PARTS = 'PECAS';
export const CENTER_SERVICES = 'SERVICOS';

/** Formas de pagamento que a tela pergunta (chaves do mix no cost-engine). */
export const PAYMENT_METHODS = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO_1X', 'CREDITO_PARCELADO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** "AAAA-MM" de uma data, no fuso de Brasília (a OS fechada às 22h do dia 31 é do mês 31, não do seguinte). */
export function periodOf(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3_600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Os `n` meses FECHADOS antes de `now`, do mais antigo ao mais novo. O mês corrente fica de fora: pela metade, distorce a média. */
export function closedMonths(now: Date, n = 12): string[] {
  const [y, m] = periodOf(now).split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Primeiro instante (UTC) do mês `period` no fuso de Brasília. */
export const monthStart = (period: string) => new Date(`${period}-01T03:00:00.000Z`);

export interface ClosedOrder {
  closedAt: Date;
  partLines: { quantity: Prisma.Decimal.Value; unitPrice: Prisma.Decimal.Value }[];
  serviceLines: { price: Prisma.Decimal.Value; hoursActual: Prisma.Decimal.Value | null }[];
}

export interface MonthTotals {
  partsRevenue: D;
  units: D;
  orders: number;
  servicesRevenue: D;
  hoursSold: D;
}

/** Soma das OS concluídas por mês de fechamento: peças (qtd × preço), unidades, OS, mão de obra e horas reais. */
export function aggregateOrders(orders: ClosedOrder[]): Map<string, MonthTotals> {
  const out = new Map<string, MonthTotals>();
  for (const o of orders) {
    const p = periodOf(o.closedAt);
    const t = out.get(p) ?? { partsRevenue: D(0), units: D(0), orders: 0, servicesRevenue: D(0), hoursSold: D(0) };
    for (const l of o.partLines) {
      t.partsRevenue = t.partsRevenue.plus(D(l.quantity).mul(D(l.unitPrice)));
      t.units = t.units.plus(D(l.quantity));
    }
    for (const l of o.serviceLines) {
      t.servicesRevenue = t.servicesRevenue.plus(D(l.price));
      if (l.hoursActual !== null) t.hoursSold = t.hoursSold.plus(D(l.hoursActual));
    }
    t.orders++;
    out.set(p, t);
  }
  return out;
}

export interface CostInputs {
  paymentMix: Partial<Record<PaymentMethod, number>> | null;
  mechanics: number | null;
  hoursPerMechanic: D | null;
}

export interface MetricPush {
  period: string;
  costCenter: string;
  body: { revenue: string | null; units: string | null; orders: number | null; productiveHours: string | null; availableHours: string | null; paymentMix: Record<string, number> | null };
}

/**
 * Métricas por mês e centro: PECAS recebe faturamento de peças, unidades e OS; SERVICOS recebe a mão de obra, as horas
 * vendidas e as disponíveis (pessoas × horas). Mês sem OS vai com faturamento nulo, para não puxar a média para zero.
 */
export function buildMetrics(periods: string[], totals: Map<string, MonthTotals>, inputs: CostInputs): MetricPush[] {
  const mix = inputs.paymentMix && Object.keys(inputs.paymentMix).length ? (inputs.paymentMix as Record<string, number>) : null;
  const available = inputs.mechanics && inputs.hoursPerMechanic ? inputs.hoursPerMechanic.mul(inputs.mechanics) : null;
  const s = (v: D) => v.toDecimalPlaces(2).toString();
  return periods.flatMap((period) => {
    const t = totals.get(period);
    return [
      {
        period,
        costCenter: CENTER_PARTS,
        body: { revenue: t && t.partsRevenue.gt(0) ? s(t.partsRevenue) : null, units: t && t.units.gt(0) ? s(t.units) : null, orders: t ? t.orders : null, productiveHours: null, availableHours: null, paymentMix: mix },
      },
      {
        period,
        costCenter: CENTER_SERVICES,
        body: {
          revenue: t && t.servicesRevenue.gt(0) ? s(t.servicesRevenue) : null,
          units: null,
          orders: t ? t.orders : null,
          productiveHours: t && t.hoursSold.gt(0) ? s(t.hoursSold) : null,
          availableHours: available ? s(available) : null,
          paymentMix: mix,
        },
      },
    ];
  });
}

/** Palavra-chave da categoria livre do contas a pagar -> categoria do modelo "oficina" no cost-engine. */
const CATEGORY_RULES: [RegExp, string][] = [
  [/alug/, 'OCUPACAO.ALUGUEL'],
  [/energia|\bluz\b|celpe|neoenergia/, 'OCUPACAO.ENERGIA'],
  [/\bagua\b|compesa|saneamento/, 'OCUPACAO.AGUA'],
  [/condom|seguranca|vigil/, 'OCUPACAO.CONDOMINIO'],
  [/pro.?labore/, 'PESSOAL.PRO_LABORE'],
  [/mecanic/, 'PESSOAL.MECANICOS'],
  [/salari|folha|funcionari/, 'PESSOAL.SALARIOS'],
  [/inss|fgts|encargo/, 'PESSOAL.ENCARGOS'],
  [/vale|beneficio|alimentacao|transporte/, 'PESSOAL.BENEFICIOS'],
  [/contab|contador/, 'SERVICOS.CONTABILIDADE'],
  [/sistema|software|assinatura|licenca/, 'SERVICOS.SISTEMAS'],
  [/internet|telefon|celular/, 'SERVICOS.TELEFONIA'],
  [/marketing|anuncio|propaganda|publicidade/, 'MARKETING'],
  [/manutenc|conserto|reparo|equipamento/, 'MANUTENCAO'],
  [/ferrament|insumo/, 'OFICINA.FERRAMENTAS'],
  [/iptu|alvara|taxa|licenciamento/, 'TRIBUTOS.OUTROS'],
];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function categorize(label: string | null | undefined): string {
  const l = fold(label ?? '');
  return CATEGORY_RULES.find(([re]) => re.test(l))?.[1] ?? 'OUTRAS';
}

/**
 * Conta paga que é despesa (vai como realizado). Ficam de fora as duplicatas de NF-e (compra de mercadoria: já está no
 * custo da peça) e o ICMS de entrada (já está no custo de aquisição): mandá-las contaria duas vezes (cost-engine §7).
 */
export function isExpensePayable(p: { source: string; category: string | null }): boolean {
  if (p.source !== 'MANUAL') return false;
  return !/tributos de entrada|icms de entrada/.test(fold(p.category ?? ''));
}
