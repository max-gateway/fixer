import type { Prisma } from '@fixer/db';
import { ConflictException } from '@nestjs/common';
import { unitCost } from './cost.js';

type Tx = Prisma.TransactionClient;

/**
 * Lança a entrada no estoque de uma nota READY (docs/specs/nfe-import.md §8.3), na transação de quem chama.
 * Devolve false se outra tentativa já lançou (ou a nota não está mais READY): o claim por UPDATE condicional
 * serializa chamadas concorrentes, e unique(purchaseInvoiceItemId, type) barra movimento duplicado.
 * Qualquer falha em um item desfaz a nota inteira.
 */
export async function postInvoice(tx: Tx, invoiceId: string, userId: string): Promise<boolean> {
  const claim = await tx.purchaseInvoice.updateMany({
    where: { id: invoiceId, status: 'FULL', exportStatus: 'READY', needsReview: false },
    data: { exportStatus: 'POSTED', postedAt: new Date(), postedById: userId },
  });
  if (claim.count === 0) return false;

  const invoice = await tx.purchaseInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { number: true, series: true, accessKey: true },
  });
  const items = await tx.purchaseInvoiceItem.findMany({ where: { invoiceId }, orderBy: { itemNumber: 'asc' } });
  const note = `NF-e ${invoice.number}/${invoice.series} · ${invoice.accessKey}`;

  for (const item of items) {
    if (item.resolution === 'IGNORED') continue;
    if (item.resolution === 'UNRESOLVED' || !item.partId) {
      throw new ConflictException(`Item ${item.itemNumber} sem vínculo: a nota não pode ser lançada`);
    }
    const cost = unitCost(item, item.unitFactor);
    if (!cost) continue; // quantidade zero: não há o que dar entrada
    const qty = item.quantity.mul(item.unitFactor);
    const part = await tx.part.update({
      where: { id: item.partId },
      data: { stockQty: { increment: qty }, costPrice: cost },
      select: { stockQty: true },
    });
    await tx.stockMovement.create({
      data: {
        partId: item.partId,
        type: 'PURCHASE',
        quantity: qty,
        balanceAfter: part.stockQty,
        purchaseInvoiceItemId: item.id,
        createdById: userId,
        note,
      },
    });
  }
  return true;
}

/** Lançamento automático (`autoExport`): só quando a nota chegou a READY e o autor configurado existe. */
export async function autoPostIfEnabled(tx: Tx, invoiceId: string): Promise<boolean> {
  const cred = await tx.fiscalCredential.findFirst({ select: { autoExport: true, autoExportById: true } });
  if (!cred?.autoExport || !cred.autoExportById) return false;
  return postInvoice(tx, invoiceId, cred.autoExportById);
}
