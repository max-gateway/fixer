import { createHash } from 'node:crypto';
import { Prisma } from '@fixer/db';
import type { PricingPlan, PricingRow } from '../../pricing/pricing-plan.js';
import type { InvoiceLedger, ItemLedger } from '../tax/cost-ledger.js';

// Fotografia imutável da entrada no estoque (docs/specs/stock-entry-snapshot.md). Função pura: recebe o que o lançamento
// já carregou e devolve o `context` e o hash. Tudo em string (decimais e datas), para o hash não depender de como o
// Prisma ou o JSON representam números.

/** Muda quando um campo passa a ser obrigatório ou muda de sentido; leitores antigos olham este número. */
export const ENTRY_SNAPSHOT_SCHEMA_VERSION = 1;

type D = Prisma.Decimal;
const s = (v: D | number | null | undefined): string | null => (v === null || v === undefined ? null : v.toString());
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface SnapshotInput {
  invoice: {
    accessKey: string;
    number: number | null;
    series: number | null;
    issuedAt: Date | null;
    issuerCnpj: string;
    issuerName: string;
    issuerUf: string | null;
    issuerCrt: number | null;
    recipientUf: string | null;
    destIndicator: number | null;
    freightMode: number | null;
  };
  item: {
    id: string;
    itemNumber: number;
    supplierCode: string;
    description: string;
    ncm: string;
    cest: string | null;
    origin: number | null;
    cfop: string;
    unit: string;
    quantity: D;
    unitFactor: D;
    unitPrice: D;
    totalPrice: D;
  };
  part: {
    id: string;
    sku: string;
    name: string;
    ncm: string | null;
    cest: string | null;
    pricingMode: string;
    icmsStStatus: string;
    pisCofinsMonofasico: boolean | null;
    taxFlagsSource: string | null;
    fiscalVerified: boolean;
  };
  before: { stockQty: D; costPrice: D; avgCost: D | null; sellPrice: D };
  after: { stockQty: D; costPrice: D; avgCost: D; sellPrice: D };
  quantity: D;
  ledger: Pick<InvoiceLedger, 'regime' | 'rulesVersion' | 'alerts'>;
  itemLedger: ItemLedger;
  /** O plano de preço desta nota; null quando não foi possível montá-lo (lançamento sem preço com perfil incompleto). */
  plan: Pick<PricingPlan, 'rulesVersion' | 'costProfile'> | null;
  row: PricingRow | null;
  /** Por que não há plano, quando `plan` é null. */
  planError: string | null;
  applyPricing: boolean;
  priceHistoryId: string | null;
  fiscal: {
    taxRegime: string | null;
    ufCode: number | null;
    profile: {
      rbt12: D | null;
      rbt12AsOf: Date | null;
      icmsSalePct: D | null;
      simplesEffectiveRatePct: D | null;
      icmsSharePct: D | null;
      pisSharePct: D | null;
      cofinsSharePct: D | null;
      requireTaxConfirmation: boolean;
      reviewedBy: string | null;
      reviewedAt: Date | null;
    } | null;
    tableReviews: { tableId: string; version: string; reviewedBy: string; reviewedAt: Date }[];
    /** Quem garantia o imposto no lançamento: contador ou fonte oficial (perfil e tabelas usadas; tax-rules.md §6). */
    trust?: { profile: string | null; tables: { tableId: string; basis: string | null; checkedAt: string | null }[] };
  };
  postedAt: Date;
  postedById: string;
}

export type PriceOutcome = 'APPLIED' | 'UNCHANGED' | 'NOT_REQUESTED' | 'LOCKED';

export interface EntrySnapshot {
  context: Record<string, unknown>;
  contentHash: string;
  priceChanged: boolean;
}

function priceOutcome(i: SnapshotInput): PriceOutcome {
  if (i.part.pricingMode === 'MANUAL') return 'LOCKED';
  if (!i.applyPricing) return 'NOT_REQUESTED';
  return i.after.sellPrice.equals(i.before.sellPrice) ? 'UNCHANGED' : 'APPLIED';
}

export function buildEntrySnapshot(i: SnapshotInput): EntrySnapshot {
  const row = i.row;
  const rule = row?.rule ?? null;
  const outcome = priceOutcome(i);
  const context = {
    schemaVersion: ENTRY_SNAPSHOT_SCHEMA_VERSION,
    document: {
      accessKey: i.invoice.accessKey,
      number: i.invoice.number,
      series: i.invoice.series,
      issuedAt: iso(i.invoice.issuedAt),
      issuer: { cnpj: i.invoice.issuerCnpj, name: i.invoice.issuerName, uf: i.invoice.issuerUf, crt: i.invoice.issuerCrt },
      recipientUf: i.invoice.recipientUf,
      destIndicator: i.invoice.destIndicator,
      freightMode: i.invoice.freightMode,
    },
    item: {
      id: i.item.id,
      itemNumber: i.item.itemNumber,
      supplierCode: i.item.supplierCode,
      description: i.item.description,
      ncm: i.item.ncm,
      cest: i.item.cest,
      origin: i.item.origin,
      cfop: i.item.cfop,
      unit: i.item.unit,
      quantity: s(i.item.quantity),
      unitFactor: s(i.item.unitFactor),
      unitPrice: s(i.item.unitPrice),
      totalPrice: s(i.item.totalPrice),
    },
    part: { id: i.part.id, sku: i.part.sku, name: i.part.name, pricingMode: i.part.pricingMode },
    stock: {
      quantity: s(i.quantity),
      before: { stockQty: s(i.before.stockQty), costPrice: s(i.before.costPrice), avgCost: s(i.before.avgCost) },
      after: { stockQty: s(i.after.stockQty), costPrice: s(i.after.costPrice), avgCost: s(i.after.avgCost) },
    },
    cost: {
      unit: s(i.itemLedger.landedCost),
      total: s(i.itemLedger.totalCost),
      cfopProfile: i.itemLedger.profile,
      regime: i.ledger.regime,
      components: i.itemLedger.components.map((c) => ({ code: c.code, treatment: c.treatment, amount: s(c.amount), source: c.source, allocated: c.allocated })),
      alerts: i.ledger.alerts
        .filter((a) => a.itemNumbers.length === 0 || a.itemNumbers.includes(i.item.itemNumber))
        .map((a) => ({ code: a.code, severity: a.severity, message: a.message })),
    },
    price: {
      outcome,
      before: s(i.before.sellPrice),
      after: s(i.after.sellPrice),
      suggested: s(row?.suggested),
      draft: s(row?.draft),
      ack: row?.ack ?? false,
      marginPct: s(row?.marginPct),
      markupPct: s(row?.markupPct),
      flags: row?.flags ?? [],
      error: row?.error ?? i.planError,
      // Despesas que o preço usou: do perfil de custos (com a versão) ou da regra.
      overhead: row && {
        source: row.overhead.source,
        variablePct: s(row.overhead.variablePct),
        fixedPct: s(row.overhead.fixedPct),
        extraUnitCost: s(row.overhead.extraUnitCost),
      },
      priceHistoryId: i.priceHistoryId,
      rule: rule && {
        id: rule.id,
        scope: rule.scope,
        scopeKey: rule.scopeKey,
        method: rule.method,
        value: s(rule.value),
        taxPctOverride: s(rule.taxPctOverride),
        overheadPct: s(rule.overheadPct),
        rounding: rule.rounding,
        minMarginPct: s(rule.minMarginPct),
        maxJumpPct: s(rule.maxJumpPct),
        updatedAt: iso(rule.updatedAt),
      },
    },
    saleTax: row && {
      pct: s(row.tax.pct),
      confidence: row.tax.confidence,
      unavailable: row.tax.unavailable,
      components: row.tax.components.map((c) => ({ code: c.code, pct: c.pct, reason: c.reason })),
    },
    fiscal: {
      taxRegime: i.fiscal.taxRegime,
      ufCode: i.fiscal.ufCode,
      part: {
        ncm: i.part.ncm,
        cest: i.part.cest,
        icmsStStatus: i.part.icmsStStatus,
        pisCofinsMonofasico: i.part.pisCofinsMonofasico,
        taxFlagsSource: i.part.taxFlagsSource,
        fiscalVerified: i.part.fiscalVerified,
      },
      profile: i.fiscal.profile && {
        rbt12: s(i.fiscal.profile.rbt12),
        rbt12AsOf: iso(i.fiscal.profile.rbt12AsOf),
        icmsSalePct: s(i.fiscal.profile.icmsSalePct),
        simplesEffectiveRatePct: s(i.fiscal.profile.simplesEffectiveRatePct),
        icmsSharePct: s(i.fiscal.profile.icmsSharePct),
        pisSharePct: s(i.fiscal.profile.pisSharePct),
        cofinsSharePct: s(i.fiscal.profile.cofinsSharePct),
        requireTaxConfirmation: i.fiscal.profile.requireTaxConfirmation,
        reviewedBy: i.fiscal.profile.reviewedBy,
        reviewedAt: iso(i.fiscal.profile.reviewedAt),
      },
      tableReviews: [...i.fiscal.tableReviews]
        .sort((a, b) => a.tableId.localeCompare(b.tableId))
        .map((r) => ({ tableId: r.tableId, version: r.version, reviewedBy: r.reviewedBy, reviewedAt: iso(r.reviewedAt) })),
      ...(i.fiscal.trust ? { trust: { profile: i.fiscal.trust.profile, tables: [...i.fiscal.trust.tables].sort((a, b) => a.tableId.localeCompare(b.tableId)) } } : {}),
    },
    engines: {
      taxRulesVersion: i.plan?.rulesVersion ?? i.ledger.rulesVersion,
      // Motores da plataforma (tax-engine, cost-engine): preenchidos quando o Fixer passar a consumi-los.
      rulesetVersion: null,
      costProfileVersion: i.plan?.costProfile?.status === 'OK' ? i.plan.costProfile.version : null,
    },
    posted: { at: iso(i.postedAt), byId: i.postedById },
  };
  return { context, contentHash: hashContext(context), priceChanged: outcome === 'APPLIED' };
}

/** JSON com as chaves em ordem alfabética em todos os níveis: o mesmo conteúdo dá sempre o mesmo texto. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** sha256 do JSON canônico; recalcular sobre o `context` gravado prova que ele não mudou. */
export function hashContext(context: unknown): string {
  return createHash('sha256').update(canonicalJson(context)).digest('hex');
}
