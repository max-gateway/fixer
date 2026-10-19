import { Prisma } from '@fixer/db';
import { loadInvoiceLedger } from '../fiscal-inbound/tax/invoice-ledger.js';
import type { InvoiceLedger } from '../fiscal-inbound/tax/cost-ledger.js';
import { TAX_RULES_VERSION } from '../fiscal-inbound/tax/rules.js';
import { blockingFlags, evaluatePrice, marginFromPrice, markupFromPrice, PricingError, suggestPrice, type PriceFlag, type PriceParams } from './pricing.js';
import { requiredTables, saleTax, type SaleTax, type SaleTaxFlags } from './sale-tax.js';
import { TABLES } from '@fixer/tax-rules';
import { taxNotes, type TaxNote } from './tax-notes.js';
import { taxReadiness, type TaxReadiness } from './tax-readiness.js';
import { resolveRule, type ResolvedRule } from './rule-resolver.js';
import { NO_COST_PROFILE, type PricingCostProfile } from './cost-profile.js';

// Monta, para cada item resolvido de uma nota, o que a precificação mostra e o que o lançamento aplica
// (docs/specs/pricing.md §5 e §6). É a MESMA função do preview e do lançamento: o que a pessoa vê é o que será gravado.

type D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value | null | undefined): D => new Prisma.Decimal(v ?? 0);

/** CST do PIS que indicam tributação monofásica na nota do fornecedor (evidência, nunca decisão). */
const MONOFASICO_PIS_CST = new Set(['02', '03', '04']);

export interface PricingRow {
  itemId: string;
  itemNumber: number;
  partId: string;
  sku: string;
  name: string;
  /** Unidades de estoque que entram. */
  stockQty: D;
  /** Custo líquido de reposição desta compra, por unidade de estoque. */
  cost: D | null;
  /** Custo gravado hoje na peça (antes do lançamento). */
  previousCost: D | null;
  currentPrice: D | null;
  ruleId: string | null;
  /** De onde veio a regra desta linha: a mais específica vence. */
  ruleScope: ResolvedRule['scope'] | null;
  rule: Prisma.PricingRuleGetPayload<object> | null;
  tax: SaleTax;
  /** Divergências entre o XML e as tabelas de regra, para a pessoa conferir. */
  taxNotes: TaxNote[];
  suggested: D | null;
  draft: D | null;
  /** O que vale: rascunho da pessoa, senão a sugestão. null = não mexe no preço. */
  proposed: D | null;
  marginPct: D | null;
  markupPct: D | null;
  flags: PriceFlag[];
  /** Flags que ainda impedem o lançamento com este preço. */
  blocking: PriceFlag[];
  ack: boolean;
  /** Motivo de não haver sugestão, em português, quando a conta falhou. */
  error: string | null;
  locked: boolean;
  /**
   * Despesas que o preço desta linha usou: do perfil de custos (estrutura + despesas de venda + custo extra por unidade) ou,
   * sem perfil, o `overheadPct` da regra. O preço sai de (custo + extra) ÷ (1 − (margem + imposto + variável + estrutura)).
   */
  overhead: { source: 'PROFILE' | 'RULE'; variablePct: D; fixedPct: D; extraUnitCost: D };
}

export interface PricingPlan {
  rows: PricingRow[];
  rulesVersion: string;
  regime: InvoiceLedger['regime'];
  hasRule: boolean;
  /** A regra padrão, usada para a prévia numérica e quando o item não tem regra mais específica. */
  rule: Prisma.PricingRuleGetPayload<object> | null;
  requireTaxConfirmation: boolean;
  /** O que falta para o imposto desta nota sair confirmado (a mesma conta da tela de configuração). */
  readiness: TaxReadiness;
  ledger: InvoiceLedger;
  /** Perfil de custos usado (ou por que não). */
  costProfile: PricingCostProfile;
}

export async function buildPricingPlan(tx: Tx, invoiceId: string, ledgerIn?: InvoiceLedger, costProfile: PricingCostProfile = NO_COST_PROFILE): Promise<PricingPlan> {
  // Com perfil publicado, as despesas vêm dele e o `overheadPct` da regra deixa de valer (cost-engine.md §14, fase 2).
  const fromProfile = costProfile.status === 'OK';
  const profileVariable = fromProfile ? D(costProfile.variablePct).plus(D(costProfile.financialPct)) : null;
  const profileFixed = fromProfile ? D(costProfile.fixedPct) : D(0);
  const extraUnit = fromProfile ? D(costProfile.extraUnitCost) : D(0);
  const ledger = ledgerIn ?? (await loadInvoiceLedger(tx, invoiceId));
  const [invoice, items, rules, profile, tableReviews] = await Promise.all([
    tx.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { issuerCnpj: true } }),
    tx.purchaseInvoiceItem.findMany({
      where: { invoiceId, partId: { not: null }, resolution: { not: 'IGNORED' } },
      orderBy: { itemNumber: 'asc' },
      include: { part: true, tax: true },
    }),
    tx.pricingRule.findMany(),
    tx.tenantTaxProfile.findFirst(),
    tx.taxTableReview.findMany(),
  ]);
  // Tabela validada = o aceite é da versão em uso; mudou a versão, o aceite cai.
  const reviewMap = new Map(tableReviews.map((r) => [r.tableId, TABLES.some((t) => t.id === r.tableId && t.version === r.version)]));
  const reviewedTables = new Set([...reviewMap].filter(([, current]) => current).map(([id]) => id));

  const defaultRule = rules.find((r) => r.scope === 'DEFAULT') ?? null;
  const requireTaxConfirmation = profile?.requireTaxConfirmation ?? false;
  const rows: PricingRow[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const item of items) {
    const part = item.part!;
    // A regra mais específica vence: peça > NCM (prefixo mais longo) > fornecedor > padrão.
    const resolved = resolveRule(rules, { partId: part.id, ncm: item.ncm, supplierCnpj: invoice.issuerCnpj });
    const rule = resolved?.rule ?? null;
    const l = ledger.items.get(item.itemNumber);
    // Custo de aquisição (o que vai para a peça) e custo de preço (com o extra por unidade do perfil).
    const cost = l?.landedCost ?? null;
    const variable = profileVariable ?? D(rule?.overheadPct);
    const priceCost = cost === null ? null : cost.plus(extraUnit);
    const locked = part.pricingMode === 'MANUAL';

    // Enquadramento: o que a pessoa confirmou na peça vale mais que a leitura do XML.
    const manual = part.taxFlagsSource === 'MANUAL';
    const stFromXml = D(item.tax?.icmsSt).plus(D(item.tax?.fcpSt)).gt(0) || D(item.tax?.stRet).gt(0) || (item.tax?.icmsKind === 'CST' && item.tax.icmsCode === '60') || (item.tax?.icmsKind === 'CSOSN' && item.tax.icmsCode === '500');
    const flags: SaleTaxFlags = {
      icmsStDone: manual ? part.icmsStStatus === 'ST_CHARGED' || part.icmsStStatus === 'ST_PAID_BEFORE' : stFromXml,
      monofasico: manual ? part.pisCofinsMonofasico === true : MONOFASICO_PIS_CST.has(item.tax?.pisCst ?? ''),
      confirmed: manual || part.fiscalVerified,
    };
    const tax = saleTax({
      regime: ledger.regime,
      profile: profile && { ...profile, reviewed: profile.reviewedAt !== null },
      tablesReviewed: requiredTables(ledger.regime, flags).every((id) => reviewedTables.has(id)),
      flags,
      override: rule?.taxPctOverride ?? null,
    });

    const rowFlags: PriceFlag[] = [];
    let suggested: D | null = null;
    let error: string | null = null;

    if (locked) rowFlags.push('LOCKED');
    else if (cost === null || cost.lte(0)) rowFlags.push('NO_COST');
    else if (l?.profile === 'NOT_RESALE') rowFlags.push('NOT_RESALE');
    else if (!rule) rowFlags.push('NO_RULE');
    else if (tax.pct === null) rowFlags.push('TAX_UNAVAILABLE');
    else {
      const params: PriceParams = { method: rule.method, value: rule.value, taxPct: tax.pct, overheadPct: variable.plus(profileFixed), rounding: rule.rounding };
      try {
        suggested = suggestPrice(priceCost!, params).price;
      } catch (e) {
        if (!(e instanceof PricingError)) throw e;
        error = e.message;
      }
    }

    const draft = item.draftSellPrice ? D(item.draftSellPrice) : null;
    const proposed = locked ? null : (draft ?? suggested);
    const taxPct = tax.pct ?? D(0);
    let marginPct: D | null = null;
    let markupPct: D | null = null;
    let blocking: PriceFlag[] = [];

    if (proposed && cost && cost.gt(0)) {
      // Margem líquida: depois do imposto, das despesas de venda e da estrutura. Markup sobre o custo de aquisição.
      marginPct = marginFromPrice(priceCost!, proposed, taxPct, variable.plus(profileFixed));
      markupPct = markupFromPrice(cost, proposed);
      if (tax.pct === null && !rowFlags.includes('TAX_UNAVAILABLE')) rowFlags.push('TAX_UNAVAILABLE');
      rowFlags.push(
        ...evaluatePrice({
          cost: priceCost!,
          proposed,
          currentPrice: part.sellPrice.gt(0) ? part.sellPrice : null,
          previousCost: part.costPrice.gt(0) ? part.costPrice : null,
          taxPct,
          overheadPct: variable,
          fixedPct: profileFixed,
          minMarginPct: D(rule?.minMarginPct),
          maxJumpPct: D(rule?.maxJumpPct ?? 25),
          taxConfirmed: tax.confidence !== 'ESTIMADO',
          requireTaxConfirmation,
        }),
      );
      blocking = blockingFlags(rowFlags, item.priceAck, requireTaxConfirmation);
    }

    rows.push({
      itemId: item.id,
      itemNumber: item.itemNumber,
      partId: part.id,
      sku: part.sku,
      name: part.name,
      stockQty: l?.stockQty ?? D(0),
      cost,
      previousCost: part.costPrice.gt(0) ? part.costPrice : null,
      currentPrice: part.sellPrice.gt(0) ? part.sellPrice : null,
      ruleId: rule?.id ?? null,
      ruleScope: resolved?.scope ?? null,
      rule,
      tax,
      taxNotes: taxNotes({ ncm: item.ncm, xmlMonofasico: MONOFASICO_PIS_CST.has(item.tax?.pisCst ?? ''), xmlSt: stFromXml, asOf: today }),
      suggested,
      draft,
      proposed,
      marginPct,
      markupPct,
      flags: rowFlags,
      blocking,
      ack: item.priceAck,
      error,
      locked,
      overhead: { source: fromProfile ? 'PROFILE' : 'RULE', variablePct: variable, fixedPct: profileFixed, extraUnitCost: extraUnit },
    });
  }

  return { rows, rulesVersion: TAX_RULES_VERSION, regime: ledger.regime, hasRule: defaultRule !== null || rules.length > 0, rule: defaultRule, requireTaxConfirmation, readiness: taxReadiness({ regime: ledger.regime, profile, tableReviews: reviewMap }), ledger, costProfile };
}

const s = (d: D | null) => (d ? d.toString() : null);

/** Forma enviada à tela: decimais como string, sem nada interno. */
export function toDto(plan: PricingPlan) {
  return {
    rulesVersion: plan.rulesVersion,
    regime: plan.regime,
    hasRule: plan.hasRule,
    rule: plan.rule && {
      method: plan.rule.method,
      value: plan.rule.value.toString(),
      overheadPct: plan.rule.overheadPct.toString(),
      rounding: plan.rule.rounding,
      minMarginPct: plan.rule.minMarginPct.toString(),
      maxJumpPct: plan.rule.maxJumpPct.toString(),
    },
    requireTaxConfirmation: plan.requireTaxConfirmation,
    taxReadiness: {
      ready: plan.readiness.ready,
      supported: plan.readiness.supported,
      regime: plan.readiness.regime,
      summary: plan.readiness.summary,
      /** Só o que bloqueia o "confirmado"; os passos opcionais (monofásico) ficam de fora. */
      missing: plan.readiness.steps.filter((s) => !s.done && !s.optional).map((s) => ({ id: s.id, label: s.label, detail: s.detail, tableId: s.tableId ?? null })),
    },
    /** Perfil de custos aplicado às despesas do preço (ou por que não foi usado). */
    costProfile: plan.costProfile,
    rows: plan.rows.map((r) => ({
      itemNumber: r.itemNumber,
      partId: r.partId,
      ruleScope: r.ruleScope,
      rule: r.rule && {
        method: r.rule.method,
        value: r.rule.value.toString(),
        overheadPct: r.rule.overheadPct.toString(),
        rounding: r.rule.rounding,
        minMarginPct: r.rule.minMarginPct.toString(),
        maxJumpPct: r.rule.maxJumpPct.toString(),
      },
      sku: r.sku,
      name: r.name,
      stockQty: r.stockQty.toString(),
      cost: s(r.cost),
      /** Componentes do custo da linha (livro de custo), para a gaveta "Por que esse preço?". */
      costComponents: (plan.ledger.items.get(r.itemNumber)?.components ?? []).map((c) => ({ code: c.code, treatment: c.treatment, amount: c.amount.toString(), source: c.source, allocated: c.allocated })),
      previousCost: s(r.previousCost),
      currentPrice: s(r.currentPrice),
      suggested: s(r.suggested),
      draft: s(r.draft),
      proposed: s(r.proposed),
      marginPct: r.marginPct ? r.marginPct.toDecimalPlaces(2).toString() : null,
      markupPct: r.markupPct ? r.markupPct.toDecimalPlaces(2).toString() : null,
      saleTax: { pct: s(r.tax.pct), confidence: r.tax.confidence, unavailable: r.tax.unavailable, components: r.tax.components },
      flags: r.flags,
      blocking: r.blocking,
      ack: r.ack,
      error: r.error,
      locked: r.locked,
      overhead: { source: r.overhead.source, variablePct: r.overhead.variablePct.toString(), fixedPct: r.overhead.fixedPct.toString(), extraUnitCost: r.overhead.extraUnitCost.toString() },
      taxNotes: r.taxNotes,
    })),
  };
}
