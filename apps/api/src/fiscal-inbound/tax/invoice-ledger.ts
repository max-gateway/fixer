import type { Prisma } from '@fixer/db';
import { computeLedger, type InvoiceLedger, type Regime } from './cost-ledger.js';

/**
 * Carrega a nota, os itens e o regime da oficina e devolve o livro de custo (docs/specs/pricing.md §5.1).
 * `factors` sobrepõe o fator de unidade de um item ainda não gravado (cadastro de peça pelo XML).
 * Nota anterior à captura tributária (sem linha em `PurchaseInvoiceItemTax`) cai no cálculo antigo, sem erro.
 */
export async function loadInvoiceLedger(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  factors: ReadonlyMap<number, Prisma.Decimal.Value> = new Map(),
): Promise<InvoiceLedger> {
  const [invoice, items, settings] = await Promise.all([
    tx.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { destIndicator: true, freightMode: true, totals: true, extraFreight: true } }),
    tx.purchaseInvoiceItem.findMany({ where: { invoiceId }, orderBy: { itemNumber: 'asc' }, include: { tax: true } }),
    tx.tenantFiscalSettings.findFirst({ select: { taxRegime: true } }),
  ]);
  return computeLedger({
    invoice,
    items: items.map((i) => ({ ...i, unitFactor: factors.get(i.itemNumber) ?? i.unitFactor })),
    regime: (settings?.taxRegime as Regime | null | undefined) ?? null,
  });
}
