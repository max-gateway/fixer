import { Prisma } from '@fixer/db';

export interface CostItem {
  quantity: Prisma.Decimal.Value;
  totalPrice: Prisma.Decimal.Value;
  discount: Prisma.Decimal.Value;
  freight: Prisma.Decimal.Value;
  insurance: Prisma.Decimal.Value;
  otherCosts: Prisma.Decimal.Value;
  ipi: Prisma.Decimal.Value;
  icmsSt: Prisma.Decimal.Value;
}

/**
 * Custo unitário (por unidade de ESTOQUE) de um item de compra (docs/specs/nfe-import.md §8.3):
 *   (vProd − vDesc + vFrete + vSeg + vOutro + vIPI + vICMSST) ÷ (qCom × fator de unidade)
 * IPI e ICMS-ST entram porque a v1 assume Simples Nacional, em que não geram crédito. O resultado usa
 * 4 casas, arredondando para o mais próximo. Quantidade zero não tem custo (devolve null).
 */
export function unitCost(item: CostItem, unitFactor: Prisma.Decimal.Value = 1): Prisma.Decimal | null {
  const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
  const stockQty = D(item.quantity).mul(D(unitFactor));
  if (stockQty.lte(0)) return null;
  const total = D(item.totalPrice)
    .minus(D(item.discount))
    .plus(D(item.freight))
    .plus(D(item.insurance))
    .plus(D(item.otherCosts))
    .plus(D(item.ipi))
    .plus(D(item.icmsSt));
  return total.div(stockQty).toDecimalPlaces(4);
}
