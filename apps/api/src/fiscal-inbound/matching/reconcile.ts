import type { Prisma } from '@fixer/db';
import { nextExportStatus, resolveItems, type ExportStatus } from './resolve.js';

type Tx = Prisma.TransactionClient;

/** Promove ou rebaixa a nota entre PENDING_MATCH e READY conforme o estado dos itens. */
export async function recomputeExportStatus(tx: Tx, invoiceId: string): Promise<void> {
  const invoice = await tx.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true, exportStatus: true, needsReview: true },
  });
  if (!invoice) return;
  const items = await tx.purchaseInvoiceItem.findMany({ where: { invoiceId }, select: { resolution: true } });
  const next = nextExportStatus(
    { status: invoice.status, exportStatus: invoice.exportStatus as ExportStatus, needsReview: invoice.needsReview },
    items.map((i) => i.resolution),
  );
  if (next && next !== invoice.exportStatus) {
    await tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { exportStatus: next } });
  }
}

/**
 * Resolve sozinho os itens UNRESOLVED da nota (vínculo do fornecedor, depois GTIN) e recalcula o estado.
 * Roda na transação de quem chama: ao gravar o lote da SEFAZ e ao aprender um vínculo novo.
 */
export async function matchInvoice(tx: Tx, invoiceId: string): Promise<{ resolved: number }> {
  const invoice = await tx.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, issuerCnpj: true, status: true },
  });
  if (!invoice || invoice.status !== 'FULL') return { resolved: 0 };
  const items = await tx.purchaseInvoiceItem.findMany({
    where: { invoiceId },
    select: { id: true, supplierCode: true, ean: true, resolution: true },
  });
  const open = items.filter((i) => i.resolution === 'UNRESOLVED');

  let resolved = 0;
  if (open.length > 0) {
    const mapRows = await tx.supplierItemMap.findMany({
      where: { supplierCnpj: invoice.issuerCnpj, supplierCode: { in: [...new Set(open.map((i) => i.supplierCode))] } },
    });
    const maps = new Map(mapRows.map((m) => [m.supplierCode, { partId: m.partId, unitFactor: m.unitFactor.toString() }]));

    const eans = [...new Set(open.flatMap((i) => (i.ean ? [i.ean] : [])))];
    const partRows = eans.length ? await tx.part.findMany({ where: { ean: { in: eans } }, select: { id: true, ean: true } }) : [];
    const partsByEan = new Map<string, string[]>();
    for (const p of partRows) partsByEan.set(p.ean!, [...(partsByEan.get(p.ean!) ?? []), p.id]);

    const resolutions = resolveItems(open.map((i) => ({ ...i })), maps, partsByEan);
    const codeOf = new Map(open.map((i) => [i.id, i.supplierCode]));
    for (const r of resolutions) {
      const supplierCode = codeOf.get(r.itemId)!;
      await tx.purchaseInvoiceItem.update({
        where: { id: r.itemId },
        data: { resolution: r.resolution, partId: r.partId, unitFactor: r.unitFactor },
      });
      if (r.learn) {
        // O primeiro vínculo vence: se outra nota do fornecedor aprendeu esse código no meio do caminho, não se sobrescreve.
        await tx.supplierItemMap.upsert({
          where: { supplierCnpj_supplierCode: { supplierCnpj: invoice.issuerCnpj, supplierCode } },
          create: { supplierCnpj: invoice.issuerCnpj, supplierCode, partId: r.partId, unitFactor: r.unitFactor },
          update: {},
        });
      } else {
        await tx.supplierItemMap.updateMany({
          where: { supplierCnpj: invoice.issuerCnpj, supplierCode },
          data: { lastUsedAt: new Date() },
        });
      }
      resolved++;
    }
  }
  await recomputeExportStatus(tx, invoiceId);
  return { resolved };
}

/**
 * Depois de aprender um vínculo, as outras notas em aberto do mesmo fornecedor que usam o mesmo código
 * se resolvem sozinhas: é o que faz o sistema "aprender" com uma conciliação só.
 */
export async function matchOpenInvoicesOfSupplier(tx: Tx, supplierCnpj: string, exceptInvoiceId?: string): Promise<number> {
  const open = await tx.purchaseInvoice.findMany({
    where: {
      issuerCnpj: supplierCnpj,
      status: 'FULL',
      exportStatus: 'PENDING_MATCH',
      ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}),
    },
    select: { id: true },
  });
  let total = 0;
  for (const { id } of open) total += (await matchInvoice(tx, id)).resolved;
  return total;
}
