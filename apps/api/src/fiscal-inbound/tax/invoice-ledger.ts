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
  const [invoice, items, settings, profile] = await Promise.all([
    tx.purchaseInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { destIndicator: true, freightMode: true, totals: true, extraFreight: true, issuerUf: true, recipientUf: true, issuedAt: true },
    }),
    tx.purchaseInvoiceItem.findMany({ where: { invoiceId }, orderBy: { itemNumber: 'asc' }, include: { tax: true } }),
    tx.tenantFiscalSettings.findFirst({ select: { taxRegime: true } }),
    tx.tenantTaxProfile.findFirst({ select: { rbt12: true, stateTaxRegular: true } }),
  ]);
  return computeLedger({
    invoice,
    items: items.map((i) => ({ ...i, unitFactor: factors.get(i.itemNumber) ?? i.unitFactor })),
    regime: (settings?.taxRegime as Regime | null | undefined) ?? null,
    // Regras de entrada da UF da oficina (hoje, PE): porte pela RBT12 e situação na SEFAZ estadual.
    buyer: { rbt12: profile?.rbt12?.toFixed(2) ?? null, stateTaxRegular: profile?.stateTaxRegular ?? null },
  });
}
