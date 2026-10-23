import { Prisma } from '@fixer/db';
import { aggregateOrders, closedMonths, monthStart, type ClosedOrder } from '../costs/sync.js';

// RBT12 estimada pelo próprio Fixer (docs/specs/fiscal-autofill.md §5.3): soma de peças e mão de obra das ordens de
// serviço concluídas nos 12 meses anteriores ao mês corrente, que é a janela da RBT12 do Simples (LC 123, art. 18, §1º).
// Fica sempre ESTIMADO: só vale se a oficina fatura tudo no Fixer. Com menos de 12 meses de histórico, não há valor (a
// proporcionalização do início de atividade está fora do escopo).

export type Rbt12Estimate =
  | { ok: true; rbt12: Prisma.Decimal; asOf: Date; from: string; to: string; orders: number }
  | { ok: false; reason: 'HISTORICO_CURTO' | 'SEM_RECEITA'; detail: string };

const mmYyyy = (period: string) => `${period.slice(5, 7)}/${period.slice(0, 4)}`;

/**
 * @param firstClosedAt fechamento da OS concluída mais antiga do tenant (null = nenhuma).
 * @param orders OS concluídas dentro da janela.
 */
export function estimateRbt12(now: Date, firstClosedAt: Date | null, orders: ClosedOrder[]): Rbt12Estimate {
  const months = closedMonths(now, 12);
  const from = months[0]!;
  const to = months[months.length - 1]!;
  // Histórico cobre a janela inteira só se já havia OS concluída no primeiro mês dela (ou antes).
  if (!firstClosedAt || firstClosedAt >= monthStart(months[1]!)) {
    return { ok: false, reason: 'HISTORICO_CURTO', detail: `O Fixer ainda não tem 12 meses de ordens de serviço (precisa de OS concluídas desde ${mmYyyy(from)}).` };
  }
  const totals = aggregateOrders(orders);
  let sum = new Prisma.Decimal(0);
  let count = 0;
  for (const m of months) {
    const t = totals.get(m);
    if (!t) continue;
    sum = sum.plus(t.partsRevenue).plus(t.servicesRevenue);
    count += t.orders;
  }
  if (sum.lte(0)) return { ok: false, reason: 'SEM_RECEITA', detail: 'Nenhuma receita nas ordens de serviço dos últimos 12 meses.' };
  const [y, mo] = to.split('-').map(Number) as [number, number];
  const current = new Date(Date.UTC(y, mo, 1)); // 1º dia do mês corrente: o período a que a RBT12 se refere
  return { ok: true, rbt12: sum.toDecimalPlaces(2), asOf: current, from: mmYyyy(from), to: mmYyyy(to), orders: count };
}

/** Janela [início, fim) das OS que entram na estimativa. */
export function estimateWindow(now: Date): { from: Date; to: Date } {
  const months = closedMonths(now, 12);
  const last = months[months.length - 1]!;
  const [y, m] = last.split('-').map(Number) as [number, number];
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
  return { from: monthStart(months[0]!), to: monthStart(next) };
}
