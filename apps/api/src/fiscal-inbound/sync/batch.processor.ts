import { createHash } from 'node:crypto';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { gzipSync } from 'node:zlib';
import type { Prisma } from '@fixer/db';
import { draftPayables } from '../../payables/installments.js';
import { matchInvoice } from '../matching/reconcile.js';
import { schemaKind, type DistDocument } from '../parser/dist-response.parser.js';
import { assessNfe, parseProcNfe, type ParsedNfe, type ParsedNfeItem } from '../parser/nfe.parser.js';
import { CANCEL_OK_STATUS, EVENT_CANCEL, parseEvent, parseResNfe } from '../parser/summary.parser.js';

export interface BatchContext {
  /** CNPJ de 14 posições da empresa. */
  tenantCnpj: string;
  now: Date;
}

export interface BatchCounters {
  summaries: number;
  full: number;
  /** Parcelas a pagar criadas a partir das duplicatas das notas. */
  payables: number;
  /** Itens ligados sozinhos a uma peça (vínculo aprendido do fornecedor ou GTIN). */
  autoResolved: number;
  canceled: number;
  /** Cancelamentos de notas cuja entrada já foi lançada: exigem ação humana (estorno). */
  canceledAfterPosting: number;
  ignored: number;
  /** Documentos inutilizáveis (XML ilegível, chave inválida, valores fora do formato). Contados, nunca fatais. */
  invalid: number;
  /** Tipos que não tratamos (eventos de manifestação, carta de correção, CT-e...). */
  skipped: number;
}

const emptyCounters = (): BatchCounters => ({
  summaries: 0,
  full: 0,
  payables: 0,
  autoResolved: 0,
  canceled: 0,
  canceledAfterPosting: 0,
  ignored: 0,
  invalid: 0,
  skipped: 0,
});

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Aplica um lote de documentos da distribuição dentro da transação do chamador.
 *
 * Um erro de banco aqui aborta a transação INTEIRA do Postgres e o lote seria reprocessado para sempre
 * (documento "veneno"). Por isso todo dado é validado ANTES de tocar no banco: um documento ruim vira
 * contador `invalid` ou nota `IGNORED`, nunca exceção.
 */
export async function processBatch(
  tx: Prisma.TransactionClient,
  documents: DistDocument[],
  ctx: BatchContext,
): Promise<BatchCounters> {
  const counters = emptyCounters();
  for (const doc of documents) {
    if (doc.error) {
      counters.invalid++;
      continue;
    }
    switch (schemaKind(doc.schema)) {
      case 'resNFe':
        await onSummary(tx, doc, ctx, counters);
        break;
      case 'procNFe':
        await onFullNfe(tx, doc, ctx, counters);
        break;
      case 'resEvento':
      case 'procEventoNFe':
        await onEvent(tx, doc, ctx, counters);
        break;
      default:
        counters.skipped++;
    }
  }
  return counters;
}

async function onSummary(tx: Prisma.TransactionClient, doc: DistDocument, ctx: BatchContext, c: BatchCounters) {
  let res;
  try {
    res = parseResNfe(doc.xml);
  } catch {
    c.invalid++;
    return;
  }
  if (!/^[A-Z0-9]{43}\d$/.test(res.accessKey)) {
    c.invalid++;
    return;
  }
  const existing = await tx.purchaseInvoice.findUnique({ where: { orgId_accessKey: { orgId: TenantContext.require(), accessKey: res.accessKey } }, select: { id: true } });
  if (existing) return; // o resumo nunca rebaixa nem altera uma nota já conhecida

  let status: 'SUMMARY' | 'IGNORED' | 'CANCELED' = 'SUMMARY';
  let ignoredReason: string | null = null;
  if (res.situation === 3) status = 'CANCELED';
  else if (res.situation === 2) [status, ignoredReason] = ['IGNORED', 'NOT_AUTHORIZED'];
  else if (res.issuerId === ctx.tenantCnpj) [status, ignoredReason] = ['IGNORED', 'ISSUED_BY_TENANT'];

  await tx.purchaseInvoice.create({
    data: {
      accessKey: res.accessKey,
      nsu: doc.nsu,
      issuedAt: res.issuedAt,
      issuerCnpj: res.issuerId,
      issuerName: res.issuerName,
      totalAmount: DECIMAL.test(res.totalAmount) ? res.totalAmount : '0',
      operationType: res.operationType,
      status,
      ignoredReason,
      canceledAt: status === 'CANCELED' ? ctx.now : null,
      exportStatus: status === 'CANCELED' ? 'VOIDED' : 'NOT_READY',
    },
  });
  if (status === 'SUMMARY') c.summaries++;
  else if (status === 'CANCELED') c.canceled++;
  else c.ignored++;
}

async function onFullNfe(tx: Prisma.TransactionClient, doc: DistDocument, ctx: BatchContext, c: BatchCounters) {
  let nfe: ParsedNfe;
  try {
    nfe = parseProcNfe(doc.xml);
  } catch {
    c.invalid++;
    return;
  }
  const verdict = assessNfe(nfe, ctx.tenantCnpj);
  if (!verdict.ok && verdict.reason === 'INVALID_KEY') {
    c.invalid++; // sem chave confiável não há como identificar a nota
    return;
  }

  const existing = await tx.purchaseInvoice.findUnique({
    where: { orgId_accessKey: { orgId: TenantContext.require(), accessKey: nfe.accessKey } },
    select: { id: true, status: true },
  });
  // Nota já completa, lançada, cancelada ou ignorada: o procNFe repetido é no-op (idempotência).
  if (existing && (existing.status === 'FULL' || existing.status === 'CANCELED' || existing.status === 'IGNORED')) return;

  const items = verdict.ok ? sanitizeItems(nfe.items) : [];
  const usable = verdict.ok && items !== null;
  if (verdict.ok && items === null) c.invalid++;

  const xml = Buffer.from(doc.xml, 'utf8');
  const data = {
    nsu: doc.nsu,
    series: nfe.series,
    number: nfe.number,
    issuedAt: nfe.issuedAt,
    issuerCnpj: nfe.issuerId,
    issuerName: nfe.issuerName,
    recipientCnpj: nfe.recipientId,
    totalAmount: DECIMAL.test(nfe.totalAmount) ? nfe.totalAmount : '0',
    finality: nfe.finality,
    operationType: nfe.operationType,
    // Guarda fiscal: o XML original é guardado mesmo quando a nota é ignorada (§9).
    xmlGz: gzipSync(xml),
    xmlSha256: createHash('sha256').update(xml).digest('hex'),
    status: usable ? ('FULL' as const) : ('IGNORED' as const),
    ignoredReason: usable ? null : verdict.ok ? 'INVALID_ITEMS' : verdict.reason,
    needsReview: usable && verdict.ok ? verdict.needsReview : false,
    // O matcher (fase 4) promove para READY quando todos os itens resolvem; até lá fica pendente.
    exportStatus: usable ? ('PENDING_MATCH' as const) : ('NOT_READY' as const),
  };

  const invoice = existing
    ? await tx.purchaseInvoice.update({ where: { id: existing.id }, data, select: { id: true } })
    : await tx.purchaseInvoice.create({ data: { accessKey: nfe.accessKey, ...data }, select: { id: true } });

  if (usable && items) {
    await tx.purchaseInvoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.purchaseInvoiceItem.createMany({ data: items.map((i) => ({ invoiceId: invoice.id, ...i })) });
    // Resolve o que já é conhecido e promove a nota a READY se nada ficou pendente (mesma transação do lote).
    c.autoResolved += (await matchInvoice(tx, invoice.id)).resolved;
    c.full++;
    // Só nota de compra utilizável gera obrigação; o createMany idempotente (orgId, nota, parcela) cobre o reprocessamento.
    const drafts = draftPayables(nfe);
    if (drafts.length > 0) {
      const { count } = await tx.payable.createMany({
        data: drafts.map((d) => ({ ...d, invoiceId: invoice.id, supplierCnpj: nfe.issuerId, supplierName: nfe.issuerName, category: 'Compras' })),
        skipDuplicates: true,
      });
      c.payables += count;
    }
  } else {
    c.ignored++;
  }
}

async function onEvent(tx: Prisma.TransactionClient, doc: DistDocument, ctx: BatchContext, c: BatchCounters) {
  let event;
  try {
    event = parseEvent(doc.xml);
  } catch {
    c.invalid++;
    return;
  }
  const effective = event.status === null || CANCEL_OK_STATUS.has(event.status);
  if (event.eventType !== EVENT_CANCEL || !effective) {
    c.skipped++;
    return;
  }
  if (!/^[A-Z0-9]{43}\d$/.test(event.accessKey)) {
    c.invalid++;
    return;
  }

  const existing = await tx.purchaseInvoice.findUnique({
    where: { orgId_accessKey: { orgId: TenantContext.require(), accessKey: event.accessKey } },
    select: { id: true, status: true, exportStatus: true },
  });

  if (!existing) {
    // O cancelamento pode chegar antes da nota (a SEFAZ o entrega sem manifestação, NT §3 nota 1). Fica um
    // registro mínimo para que a nota, se aparecer depois, nasça cancelada e nunca entre em estoque.
    await tx.purchaseInvoice.create({
      data: {
        accessKey: event.accessKey,
        nsu: doc.nsu,
        issuerCnpj: event.accessKey.slice(6, 20),
        issuerName: '',
        totalAmount: '0',
        status: 'CANCELED',
        canceledAt: ctx.now,
        exportStatus: 'VOIDED',
      },
    });
    c.canceled++;
    return;
  }
  if (existing.status === 'CANCELED') return;

  const posted = existing.exportStatus === 'POSTED';
  // Nota cancelada não se paga. Parcela já paga fica como está: a devolução do dinheiro é um assunto humano.
  await tx.payable.updateMany({ where: { invoiceId: existing.id, status: 'OPEN' }, data: { status: 'CANCELED' } });
  await tx.purchaseInvoice.update({
    where: { id: existing.id },
    // Entrada já lançada continua POSTED: o estorno é manual, com guarda de saldo (§8.5).
    data: { status: 'CANCELED', canceledAt: ctx.now, ...(posted ? {} : { exportStatus: 'VOIDED' as const }) },
  });
  c.canceled++;
  if (posted) c.canceledAfterPosting++;
}

/** Valida e normaliza os itens; null se qualquer um viola o formato (a nota inteira vira IGNORED). */
function sanitizeItems(items: ParsedNfeItem[]): ParsedNfeItem[] | null {
  const seen = new Set<number>();
  for (const i of items) {
    if (!Number.isInteger(i.itemNumber) || i.itemNumber < 1 || seen.has(i.itemNumber)) return null;
    seen.add(i.itemNumber);
    const decimals = [i.quantity, i.unitPrice, i.totalPrice, i.discount, i.freight, i.insurance, i.otherCosts, i.ipi, i.icmsSt];
    if (!decimals.every((d) => DECIMAL.test(d))) return null;
    if (!i.supplierCode) return null;
  }
  return items;
}
