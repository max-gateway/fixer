import { Prisma } from '@fixer/db';
import type { ClosedOrder } from '../costs/sync.js';

// Receita do trimestre-calendário em curso, das ordens de serviço concluídas no Fixer. Serve só para saber se o Lucro Presumido já
// passou do limite de R$ 1.250.000 por trimestre, a partir do qual a presunção sobe 10% (LC 224/2025; IN RFB 2.305/2025, art. 15,
// § 2º, com a IN 2.306/2026). Vale como a RBT12 estimada: só confere se a oficina fatura tudo no Fixer.

/** Primeiro instante do trimestre-calendário (jan, abr, jul, out) que contém `now`, em UTC. */
export function quarterStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
}

/** Soma de peças (qtd × preço) e mão de obra das OS concluídas desde o início do trimestre de `now` até `now`. */
export function quarterRevenue(now: Date, orders: ClosedOrder[]): Prisma.Decimal {
  const from = quarterStart(now);
  let sum = new Prisma.Decimal(0);
  for (const o of orders) {
    if (o.closedAt < from || o.closedAt > now) continue;
    for (const l of o.partLines) sum = sum.plus(new Prisma.Decimal(l.quantity).mul(new Prisma.Decimal(l.unitPrice)));
    for (const l of o.serviceLines) sum = sum.plus(new Prisma.Decimal(l.price));
  }
  return sum;
}
