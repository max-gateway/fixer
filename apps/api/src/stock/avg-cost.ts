import type { Prisma } from '@fixer/db';

/** Custo médio ponderado: o saldo antes da entrada pesa com o custo médio atual; saldo zero ou negativo recomeça no custo da entrada. */
export function nextAvgCost(prev: { stockQty: Prisma.Decimal; avgCost: Prisma.Decimal | null; costPrice: Prisma.Decimal }, qty: Prisma.Decimal, cost: Prisma.Decimal): Prisma.Decimal {
  if (prev.stockQty.lte(0)) return cost;
  const base = prev.avgCost ?? prev.costPrice;
  return base.mul(prev.stockQty).plus(cost.mul(qty)).div(prev.stockQty.plus(qty)).toDecimalPlaces(4);
}
