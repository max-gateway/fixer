import { gunzipSync } from 'node:zlib';
import type { Prisma } from '@fixer/db';
import { parseProcNfe } from '../parser/nfe.parser.js';
import { headerTaxData, saveItemTaxes } from './persist.js';

export interface BackfillResult {
  /** Notas que ainda não tinham linha tributária nos itens e foram examinadas. */
  scanned: number;
  updated: number;
  /** Todas as notas examinadas: o chamador as passa em `skip` para uma nota que continua sem linhas não voltar sempre. */
  scannedIds: string[];
  /** XML ilegível: a nota fica como está. O chamador passa estes ids em `skip` para não repeti-las na mesma execução. */
  failedIds: string[];
}

interface Db {
  $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Preenche a captura tributária (docs/specs/pricing.md §4.0) das notas completas importadas antes dela existir, a partir do
 * `xmlGz` guardado. Idempotente: só toca nota com algum item sem linha em `PurchaseInvoiceItemTax`. Nunca altera valores
 * de item, estoque nem `Part.costPrice`: nota já lançada mantém o custo que foi gravado na época. Cada nota é uma
 * transação, então uma falha não deixa meia captura.
 */
export async function backfillInvoiceTax(db: Db, opts: { limit?: number; skip?: ReadonlySet<string> } = {}): Promise<BackfillResult> {
  const invoices = await db.$transaction((tx) =>
    tx.purchaseInvoice.findMany({
      where: { status: 'FULL', xmlGz: { not: null }, items: { some: { tax: { is: null } } }, id: { notIn: [...(opts.skip ?? [])] } },
      select: { id: true, xmlGz: true },
      orderBy: { receivedAt: 'asc' },
      take: opts.limit ?? 100,
    }),
  );
  const result: BackfillResult = { scanned: invoices.length, updated: 0, scannedIds: invoices.map((i) => i.id), failedIds: [] };
  for (const inv of invoices) {
    try {
      const nfe = parseProcNfe(gunzipSync(Buffer.from(inv.xmlGz!)).toString('utf8'));
      await db.$transaction(async (tx) => {
        await tx.purchaseInvoice.update({ where: { id: inv.id }, data: headerTaxData(nfe) });
        await saveItemTaxes(tx, inv.id, nfe.items);
      });
      result.updated++;
    } catch {
      result.failedIds.push(inv.id);
    }
  }
  return result;
}
