import { Prisma } from '@fixer/db';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { buildPricingPlan, type PricingRow } from '../../pricing/pricing-plan.js';
import { loadInvoiceLedger } from '../tax/invoice-ledger.js';

type Tx = Prisma.TransactionClient;

export interface PostOptions {
  /** Aplica os preços de venda (rascunho ou sugestão) junto com a entrada (docs/specs/pricing.md §6.2). Sem isto o preço nunca muda. */
  applyPricing?: boolean;
}

/** Custo médio ponderado: o saldo antes da entrada pesa com o custo médio atual; saldo zero ou negativo recomeça no custo da compra. */
export function nextAvgCost(prev: { stockQty: Prisma.Decimal; avgCost: Prisma.Decimal | null; costPrice: Prisma.Decimal }, qty: Prisma.Decimal, cost: Prisma.Decimal): Prisma.Decimal {
  if (prev.stockQty.lte(0)) return cost;
  const base = prev.avgCost ?? prev.costPrice;
  return base.mul(prev.stockQty).plus(cost.mul(qty)).div(prev.stockQty.plus(qty)).toDecimalPlaces(4);
}

/**
 * Lança a entrada no estoque de uma nota READY (docs/specs/nfe-import.md §8.3), na transação de quem chama.
 * Devolve false se outra tentativa já lançou (ou a nota não está mais READY): o claim por UPDATE condicional
 * serializa chamadas concorrentes, e unique(purchaseInvoiceItemId, type) barra movimento duplicado.
 * Qualquer falha em um item desfaz a nota inteira, inclusive um preço que a guarda de precificação recusa.
 */
export async function postInvoice(tx: Tx, invoiceId: string, userId: string, opts: PostOptions = {}): Promise<boolean> {
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
  // Custo líquido de reposição (docs/specs/pricing.md §5.1): a mesma conta que a tela mostra.
  const ledger = await loadInvoiceLedger(tx, invoiceId);
  // O plano de preço lê o custo e o preço ATUAIS das peças, então precisa ser montado antes de a entrada mexer nelas.
  const plan = opts.applyPricing ? await buildPricingPlan(tx, invoiceId, ledger) : null;
  const rows = new Map<number, PricingRow>((plan?.rows ?? []).map((r) => [r.itemNumber, r]));
  if (plan) {
    const refused = plan.rows.filter((r) => r.proposed && r.blocking.length > 0);
    if (refused.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Há preços que precisam de atenção antes de lançar a nota.',
        items: refused.map((r) => ({ itemNumber: r.itemNumber, sku: r.sku, flags: r.blocking })),
      });
    }
  }
  const note = `NF-e ${invoice.number}/${invoice.series} · ${invoice.accessKey}`;

  for (const item of items) {
    if (item.resolution === 'IGNORED') continue;
    if (item.resolution === 'UNRESOLVED' || !item.partId) {
      throw new ConflictException(`Item ${item.itemNumber} sem vínculo: a nota não pode ser lançada`);
    }
    const l = ledger.items.get(item.itemNumber);
    const cost = l?.landedCost;
    if (!cost) continue; // quantidade zero: não há o que dar entrada
    const qty = item.quantity.mul(item.unitFactor);
    const before = await tx.part.findUniqueOrThrow({ where: { id: item.partId }, select: { stockQty: true, avgCost: true, costPrice: true, sellPrice: true } });
    const row = rows.get(item.itemNumber);
    const newPrice = row?.proposed ?? null;
    const part = await tx.part.update({
      where: { id: item.partId },
      data: {
        stockQty: { increment: qty },
        costPrice: cost,
        avgCost: nextAvgCost(before, qty, cost),
        ...(newPrice ? { sellPrice: newPrice } : {}),
      },
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
    if (row && plan) {
      // O que foi calculado fica no item: explica o preço mesmo depois que a lei ou as tabelas mudarem.
      await tx.purchaseInvoiceItem.update({
        where: { id: item.id },
        data: {
          suggestedSellPrice: row.suggested,
          appliedSellPrice: newPrice,
          pricingRuleId: row.ruleId,
          costSnapshot: {
            landed: cost.toString(),
            components: l!.components.map((c) => ({ code: c.code, treatment: c.treatment, amount: c.amount.toString(), source: c.source, allocated: c.allocated })),
            regime: ledger.regime,
            rulesVersion: ledger.rulesVersion,
          },
          saleTaxSnapshot: { pct: row.tax.pct?.toString() ?? null, confidence: row.tax.confidence, components: row.tax.components.map((c) => ({ ...c })) },
        },
      });
      if (newPrice) {
        await tx.partPriceHistory.create({
          data: {
            partId: item.partId,
            costBefore: before.costPrice,
            costAfter: cost,
            sellBefore: before.sellPrice,
            sellAfter: newPrice,
            marginAfter: row.marginPct,
            saleTaxPct: row.tax.pct,
            costBreakdown: { components: l!.components.map((c) => ({ code: c.code, treatment: c.treatment, amount: c.amount.toString() })) },
            saleTaxBreakdown: { confidence: row.tax.confidence, components: row.tax.components.map((c) => ({ ...c })) },
            taxRulesVersion: plan.rulesVersion,
            source: 'INVOICE',
            purchaseInvoiceItemId: item.id,
            pricingRuleId: row.ruleId,
            createdById: userId,
          },
        });
      }
    }
  }
  return true;
}

/** Lançamento automático (`autoExport`): só quando a nota chegou a READY e o autor configurado existe. Nunca mexe em preço. */
export async function autoPostIfEnabled(tx: Tx, invoiceId: string): Promise<boolean> {
  const cred = await tx.fiscalCredential.findFirst({ select: { autoExport: true, autoExportById: true } });
  if (!cred?.autoExport || !cred.autoExportById) return false;
  return postInvoice(tx, invoiceId, cred.autoExportById);
}
