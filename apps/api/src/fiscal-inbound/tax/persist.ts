import { Prisma } from '@fixer/db';
import type { ParsedItemTax, ParsedNfe } from '../parser/nfe.parser.js';

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Decimal válido ou null: um campo tributário malformado nunca derruba a nota (só o custo usa o que for legível). */
const dec = (v: string | null): string | null => (v !== null && DECIMAL.test(v) ? v : null);

/** Campos tributários do cabeçalho da nota (docs/specs/pricing.md §4.0). */
export function headerTaxData(nfe: ParsedNfe) {
  const totals: Record<string, string> = {};
  for (const [k, v] of Object.entries(nfe.totals)) if (DECIMAL.test(v)) totals[k] = v;
  return {
    issuerCrt: nfe.issuerCrt,
    issuerUf: nfe.issuerUf,
    recipientUf: nfe.recipientUf,
    destIndicator: nfe.destIndicator,
    freightMode: nfe.freightMode,
    totals: Object.keys(totals).length > 0 ? totals : Prisma.DbNull,
  };
}

/** Linha de `PurchaseInvoiceItemTax` de um item, sem o `itemId`. */
export function itemTaxData(t: ParsedItemTax) {
  return {
    indTot: t.indTot,
    icmsKind: t.icmsKind,
    icmsCode: t.icmsCode,
    icmsBase: dec(t.icmsBase),
    icmsRate: dec(t.icmsRate),
    icms: dec(t.icms),
    stBase: dec(t.stBase),
    stRate: dec(t.stRate),
    icmsSt: dec(t.icmsSt),
    fcpSt: dec(t.fcpSt),
    stRet: dec(t.stRet),
    fcpStRet: dec(t.fcpStRet),
    deson: dec(t.deson),
    creditSnRate: dec(t.creditSnRate),
    creditSn: dec(t.creditSn),
    ipiCst: t.ipiCst,
    pisCst: t.pisCst,
    pis: dec(t.pis),
    cofinsCst: t.cofinsCst,
    cofins: dec(t.cofins),
    ibsCbs: t.ibsCbs ? (t.ibsCbs as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}

/** Grava as linhas tributárias dos itens já criados (casa por `itemNumber`). Idempotente: refaz do zero. */
export async function saveItemTaxes(tx: Prisma.TransactionClient, invoiceId: string, parsed: { itemNumber: number; tax: ParsedItemTax }[]) {
  const rows = await tx.purchaseInvoiceItem.findMany({ where: { invoiceId }, select: { id: true, itemNumber: true } });
  const idByNumber = new Map(rows.map((r) => [r.itemNumber, r.id]));
  await tx.purchaseInvoiceItemTax.deleteMany({ where: { itemId: { in: rows.map((r) => r.id) } } });
  const data = parsed.flatMap((p) => {
    const itemId = idByNumber.get(p.itemNumber);
    return itemId ? [{ itemId, ...itemTaxData(p.tax) }] : [];
  });
  if (data.length > 0) await tx.purchaseInvoiceItemTax.createMany({ data });
}
