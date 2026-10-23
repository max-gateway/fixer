import { Prisma } from '@fixer/db';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { PricingCostProfile } from '../../pricing/cost-profile.js';
import { buildPricingPlan, type PricingPlan, type PricingRow } from '../../pricing/pricing-plan.js';
import { nextAvgCost } from '../../stock/avg-cost.js';
import type { Regime } from '../../pricing/sale-tax.js';
import { taxReadiness } from '../../pricing/tax-readiness.js';
import { loadTaxTrust } from '../../pricing/tax-trust.js';
import { loadInvoiceLedger } from '../tax/invoice-ledger.js';
import { buildEntrySnapshot, ENTRY_SNAPSHOT_SCHEMA_VERSION, type SnapshotInput } from './entry-snapshot.js';

type Tx = Prisma.TransactionClient;

export interface PostOptions {
  /** Aplica os preços de venda (rascunho ou sugestão) junto com a entrada (docs/specs/pricing.md §6.2). Sem isto o preço nunca muda. */
  applyPricing?: boolean;
  /** Perfil de custos (cost-engine) para as despesas do preço; sem ele, vale o `overheadPct` da regra. */
  costProfile?: PricingCostProfile;
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
    select: {
      number: true, series: true, accessKey: true, issuedAt: true, issuerCnpj: true, issuerName: true,
      issuerUf: true, issuerCrt: true, recipientUf: true, destIndicator: true, freightMode: true,
    },
  });
  const items = await tx.purchaseInvoiceItem.findMany({ where: { invoiceId }, orderBy: { itemNumber: 'asc' } });
  // Custo líquido de reposição (docs/specs/pricing.md §5.1): a mesma conta que a tela mostra.
  const ledger = await loadInvoiceLedger(tx, invoiceId);
  // O plano de preço lê o custo e o preço ATUAIS das peças, então precisa ser montado antes de a entrada mexer nelas.
  // Sem pedido de preço o plano só alimenta o snapshot: se não der para montá-lo, o lançamento segue sem ele.
  let plan: PricingPlan | null = null;
  let planError: string | null = null;
  if (opts.applyPricing) plan = await buildPricingPlan(tx, invoiceId, ledger, opts.costProfile);
  else {
    try {
      plan = await buildPricingPlan(tx, invoiceId, ledger, opts.costProfile);
    } catch (e) {
      planError = e instanceof Error ? e.message : String(e);
    }
  }
  const fiscal = await loadFiscalContext(tx);
  const rows = new Map<number, PricingRow>((plan?.rows ?? []).map((r) => [r.itemNumber, r]));
  if (plan && opts.applyPricing) {
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
    const before = await tx.part.findUniqueOrThrow({
      where: { id: item.partId },
      select: {
        stockQty: true, avgCost: true, costPrice: true, sellPrice: true, sku: true, name: true, ncm: true, cest: true,
        pricingMode: true, icmsStStatus: true, pisCofinsMonofasico: true, taxFlagsSource: true, fiscalVerified: true,
      },
    });
    const row = rows.get(item.itemNumber);
    const newPrice = opts.applyPricing ? (row?.proposed ?? null) : null;
    const avgAfter = nextAvgCost(before, qty, cost);
    const part = await tx.part.update({
      where: { id: item.partId },
      data: {
        stockQty: { increment: qty },
        costPrice: cost,
        avgCost: avgAfter,
        ...(newPrice ? { sellPrice: newPrice } : {}),
      },
      select: { stockQty: true, sellPrice: true },
    });
    const movement = await tx.stockMovement.create({
      data: {
        partId: item.partId,
        type: 'PURCHASE',
        quantity: qty,
        balanceAfter: part.stockQty,
        purchaseInvoiceItemId: item.id,
        createdById: userId,
        note,
        unitCost: cost,
        avgCostBefore: before.avgCost ?? (before.stockQty.gt(0) ? before.costPrice : null),
        avgCostAfter: avgAfter,
      },
    });
    let priceHistoryId: string | null = null;
    if (row && plan && opts.applyPricing) {
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
        ({ id: priceHistoryId } = await tx.partPriceHistory.create({
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
          select: { id: true },
        }));
      }
    }
    // Fotografia imutável do lançamento, com ou sem preço (docs/specs/stock-entry-snapshot.md).
    const snap = buildEntrySnapshot({
      invoice,
      item,
      part: { id: item.partId, ...before },
      before,
      after: { stockQty: part.stockQty, costPrice: cost, avgCost: avgAfter, sellPrice: part.sellPrice },
      quantity: qty,
      ledger,
      itemLedger: l!,
      plan,
      row: row ?? null,
      planError,
      applyPricing: opts.applyPricing === true,
      priceHistoryId,
      fiscal,
      postedAt: new Date(),
      postedById: userId,
    });
    await tx.stockEntrySnapshot.create({
      data: {
        stockMovementId: movement.id,
        partId: item.partId,
        purchaseInvoiceItemId: item.id,
        schemaVersion: ENTRY_SNAPSHOT_SCHEMA_VERSION,
        quantity: qty,
        unitCost: cost,
        totalCost: l!.totalCost,
        avgCostAfter: avgAfter,
        sellPriceAfter: part.sellPrice,
        priceChanged: snap.priceChanged,
        taxRulesVersion: plan?.rulesVersion ?? ledger.rulesVersion,
        costProfileVersion: plan?.costProfile.status === 'OK' ? plan.costProfile.version : null,
        context: snap.context as Prisma.InputJsonValue,
        contentHash: snap.contentHash,
        createdById: userId,
      },
    });
  }
  return true;
}

/** Regime, UF, perfil tributário e aceites do contador vigentes no instante do lançamento (entram no snapshot). */
async function loadFiscalContext(tx: Tx): Promise<SnapshotInput['fiscal']> {
  const [settings, profile, tableReviews] = await Promise.all([
    tx.tenantFiscalSettings.findFirst({ select: { taxRegime: true, ufCode: true } }),
    tx.tenantTaxProfile.findFirst(),
    tx.taxTableReview.findMany({ select: { tableId: true, version: true, reviewedBy: true, reviewedAt: true } }),
  ]);
  const regime = (settings?.taxRegime as Regime | null | undefined) ?? null;
  const trust = await loadTaxTrust(tx, regime, profile);
  const used = taxReadiness({ regime, profile, profileTrust: trust.profile, tables: trust.tables }).requiredTables;
  return {
    taxRegime: settings?.taxRegime ?? null,
    ufCode: settings?.ufCode ?? null,
    profile,
    tableReviews,
    trust: { profile: trust.profile.basis, tables: used.map((tableId) => ({ tableId, basis: trust.tables.get(tableId)?.basis ?? null, checkedAt: trust.tables.get(tableId)?.checkedAt ?? null })) },
  };
}

/** Lançamento automático (`autoExport`): só quando a nota chegou a READY e o autor configurado existe. Nunca mexe em preço. */
export async function autoPostIfEnabled(tx: Tx, invoiceId: string): Promise<boolean> {
  const cred = await tx.fiscalCredential.findFirst({ select: { autoExport: true, autoExportById: true } });
  if (!cred?.autoExport || !cred.autoExportById) return false;
  return postInvoice(tx, invoiceId, cred.autoExportById);
}
