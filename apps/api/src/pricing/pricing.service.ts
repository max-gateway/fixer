import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CostProfileProvider } from '../costs/cost-profile.provider.js';
import { NO_COST_PROFILE } from './cost-profile.js';
import { Prisma } from '@fixer/db';
import { z } from 'zod';
import { markManual, sameValue, type AutofillField } from '../fiscal-autofill/provenance.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { buildPricingPlan, toDto } from './pricing-plan.js';
import { sourceCheck, TABLES } from '@fixer/tax-rules';
import { TAX_RULES_VERSION } from '../fiscal-inbound/tax/rules.js';
import { hashContext } from '../fiscal-inbound/matching/entry-snapshot.js';
import { PricingError, suggestPrice } from './pricing.js';
import type { Regime } from './sale-tax.js';
import { buildTaxOverview } from './tax-overview.js';
import { taxReadiness } from './tax-readiness.js';
import { loadTaxTrust, tableTrust } from './tax-trust.js';

const pct = (max: number) => z.number({ invalid_type_error: 'Informe um número' }).min(0, 'Não pode ser negativo').max(max, `No máximo ${max}`);

/** Regra de preço da oficina (fase 1: só a padrão). */
export const RuleSchema = z.object({
  method: z.enum(['MARGIN', 'MARKUP']).default('MARGIN'),
  value: pct(1000),
  taxPctOverride: pct(99).nullable().default(null),
  overheadPct: pct(99).default(0),
  rounding: z.enum(['NONE', 'CENTS_90', 'CENTS_00', 'MULTIPLE_5', 'MULTIPLE_10']).default('CENTS_90'),
  minMarginPct: pct(99).default(0),
  maxJumpPct: pct(1000).default(25),
});

/** Perfil tributário: percentuais informados pelo contador. Sem nenhum valor padrão. */
export const TaxProfileSchema = z.object({
  icmsSalePct: pct(100).nullable().default(null),
  rbt12: z.number({ invalid_type_error: 'RBT12 inválida' }).min(0).max(1_000_000_000).nullable().default(null),
  rbt12AsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullable().default(null),
  simplesEffectiveRatePct: pct(100).nullable(),
  icmsSharePct: pct(100).nullable(),
  pisSharePct: pct(100).nullable(),
  cofinsSharePct: pct(100).nullable(),
  requireTaxConfirmation: z.boolean().default(false),
  /** Em dia com a SEFAZ estadual (PE: art. 393-A do RICMS); null = não informado. */
  stateTaxRegular: z.boolean().nullable().default(null),
});

/** "Revisei estes percentuais" (contador ou quem tem `fiscal.verify`). */
export const ReviewSchema = z.object({ reviewedBy: z.string().trim().min(2, 'Informe quem validou').max(120) });

export const DraftSchema = z.object({
  sellPrice: z.number({ invalid_type_error: 'Preço inválido' }).positive('O preço precisa ser maior que zero').max(1_000_000).nullable(),
  ack: z.boolean().optional(),
});

export const TaxFlagsSchema = z.object({
  icmsStStatus: z.enum(['UNKNOWN', 'NOT_ST', 'ST_CHARGED', 'ST_PAID_BEFORE']),
  pisCofinsMonofasico: z.boolean().nullable(),
});

/** Regra com escopo: a mais específica vence (peça > NCM > fornecedor > padrão). */
export const ScopedRuleSchema = RuleSchema.extend({
  scope: z.enum(['SUPPLIER', 'NCM', 'PART']),
  scopeKey: z.string().trim().min(1, 'Informe a quem a regra se aplica').max(60),
});

export const BulkSchema = z.object({ action: z.enum(['ACCEPT_SUGGESTIONS', 'CLEAR_DRAFTS']) });

export const PricingModeSchema = z.object({ mode: z.enum(['AUTO', 'MANUAL']) });

const EDITABLE = ['PENDING_MATCH', 'READY'];
const ruleView = (r: Prisma.PricingRuleGetPayload<object>) => ({
  id: r.id,
  method: r.method,
  value: r.value.toString(),
  taxPctOverride: r.taxPctOverride?.toString() ?? null,
  overheadPct: r.overheadPct.toString(),
  rounding: r.rounding,
  minMarginPct: r.minMarginPct.toString(),
  maxJumpPct: r.maxJumpPct.toString(),
});

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly costProfile?: CostProfileProvider,
  ) {}

  /** Despesas do perfil de custos (cost-engine), buscadas fora da transação: uma chamada HTTP não segura o banco. */
  private profile() {
    return this.costProfile?.forPricing() ?? Promise.resolve(NO_COST_PROFILE);
  }

  // ---- regra padrão ----

  async getRule() {
    const rule = await this.prisma.pricingRule.findFirst({ where: { scope: 'DEFAULT' } });
    return { rule: rule ? ruleView(rule) : null };
  }

  async saveRule(input: z.infer<typeof RuleSchema>) {
    const rule = await this.upsertRule('DEFAULT', '', input);
    return { rule: ruleView(rule) };
  }

  /** Todas as regras (padrão e exceções), com um rótulo legível de a quem cada uma se aplica. */
  async listRules() {
    const rules = await this.prisma.pricingRule.findMany({ orderBy: [{ scope: 'asc' }, { scopeKey: 'asc' }] });
    const partIds = rules.filter((r) => r.scope === 'PART').map((r) => r.scopeKey);
    const parts = partIds.length ? await this.prisma.part.findMany({ where: { id: { in: partIds } }, select: { id: true, sku: true, name: true } }) : [];
    const label = new Map(parts.map((p) => [p.id, `${p.sku} · ${p.name}`]));
    return {
      rules: rules.map((r) => ({ ...ruleView(r), scope: r.scope, scopeKey: r.scopeKey, target: r.scope === 'PART' ? (label.get(r.scopeKey) ?? r.scopeKey) : r.scopeKey })),
    };
  }

  async saveScopedRule(input: z.infer<typeof ScopedRuleSchema>) {
    const { scope, scopeKey: raw, ...rule } = input;
    let scopeKey = raw;
    if (scope === 'SUPPLIER') {
      scopeKey = raw.toUpperCase().replace(/[.\-/\s]/g, '');
      if (!/^([A-Z0-9]{14}|\d{11})$/.test(scopeKey)) throw new BadRequestException('Informe o CNPJ (14 caracteres) ou o CPF (11 dígitos) do fornecedor');
    } else if (scope === 'NCM') {
      scopeKey = raw.replace(/\D/g, '');
      if (!/^\d{2,8}$/.test(scopeKey)) throw new BadRequestException('Informe de 2 a 8 dígitos do NCM (o prefixo vale para todos os NCM que começam assim)');
    } else {
      // Quem digita é o SKU; o id também vale (a regra guarda sempre o id, que não muda se o SKU for editado).
      const part = await this.prisma.part.findFirst({ where: { OR: [{ id: raw }, { sku: raw }] }, select: { id: true } });
      if (!part) throw new NotFoundException('Peça não encontrada: confira o SKU');
      scopeKey = part.id;
    }
    return { rule: ruleView(await this.upsertRule(scope, scopeKey, rule)) };
  }

  async deleteRule(id: string) {
    const rule = await this.prisma.pricingRule.findUnique({ where: { id }, select: { scope: true } });
    if (!rule) throw new NotFoundException('Regra não encontrada');
    if (rule.scope === 'DEFAULT') throw new ConflictException('A regra padrão não pode ser apagada, só editada');
    await this.prisma.pricingRule.delete({ where: { id } });
    return { deleted: id };
  }

  private async upsertRule(scope: 'DEFAULT' | 'SUPPLIER' | 'NCM' | 'PART', scopeKey: string, input: z.infer<typeof RuleSchema>) {
    // Antes de gravar, confere que existe preço possível (percentuais que somam 100% ou mais não têm).
    try {
      suggestPrice(100, { method: input.method, value: input.value, taxPct: input.taxPctOverride ?? 0, overheadPct: input.overheadPct, rounding: input.rounding });
    } catch (e) {
      if (e instanceof PricingError) throw new BadRequestException(e.message);
      throw e;
    }
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.pricingRule.findFirst({ where: { scope, scopeKey }, select: { id: true } });
      return found ? tx.pricingRule.update({ where: { id: found.id }, data: input }) : tx.pricingRule.create({ data: { scope, scopeKey, ...input } });
    });
  }

  /** As tabelas de regra tributária em uso: versão, vigência, fontes oficiais e o que cada uma não cobre. */
  async taxTables() {
    const reviews = await this.prisma.taxTableReview.findMany();
    const trust = tableTrust(reviews);
    return {
      rulesVersion: TAX_RULES_VERSION,
      tables: TABLES.map((t) => {
        const r = reviews.find((x) => x.tableId === t.id);
        const check = sourceCheck(t);
        return {
          id: t.id,
          version: t.version,
          effectiveFrom: t.effectiveFrom,
          effectiveTo: t.effectiveTo,
          sources: t.sources,
          caveats: t.caveats,
          /** Aceite do contador desta organização; `current` é falso quando foi dado a outra versão da tabela. */
          review: r ? { reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt.toISOString(), version: r.version, current: r.version === t.version } : null,
          /** Conferência automática da versão em uso com o texto oficial (`verify:sources`); vale como validação. */
          sourceCheck: check ? { checkedAt: check.checkedAt, checks: check.checks } : null,
          basis: trust.get(t.id)?.basis ?? null,
        };
      }),
    };
  }

  /** O contador valida uma tabela de regra na versão em uso (exige `fiscal.verify`). */
  async reviewTaxTable(tableId: string, input: z.infer<typeof ReviewSchema>) {
    const table = TABLES.find((t) => t.id === tableId);
    if (!table) throw new NotFoundException('Tabela de regra desconhecida');
    await this.prisma.$transaction(async (tx) => {
      const data = { version: table.version, reviewedBy: input.reviewedBy, reviewedAt: new Date() };
      const prev = await tx.taxTableReview.findFirst({ where: { tableId } });
      if (prev) await tx.taxTableReview.update({ where: { orgId_tableId: { orgId: prev.orgId, tableId } }, data });
      else await tx.taxTableReview.create({ data: { tableId, ...data } });
    });
    return this.taxTables();
  }

  // ---- perfil tributário ----

  async getTaxProfile() {
    const [p, settings] = await Promise.all([this.prisma.tenantTaxProfile.findFirst(), this.prisma.tenantFiscalSettings.findFirst({ select: { taxRegime: true } })]);
    const regime = (settings?.taxRegime as Regime | null | undefined) ?? null;
    const trust = await loadTaxTrust(this.prisma, regime, p);
    return {
      profile: p && { ...this.profileView(p), trust: trust.profile.basis, origin: trust.origin },
      readiness: taxReadiness({ regime, profile: p, profileTrust: trust.profile, tables: trust.tables, origin: trust.origin }),
    };
  }

  /** O que o motor tributário calcula hoje para esta oficina (tela Tributário): faixa, alíquota, repartição, limites e fidelidade. */
  async taxOverview() {
    const [p, settings, rbtProv] = await Promise.all([
      this.prisma.tenantTaxProfile.findFirst({ select: { rbt12: true } }),
      this.prisma.tenantFiscalSettings.findFirst({ select: { taxRegime: true, municipalityIbge: true, lc116Item: true, issRate: true } }),
      this.prisma.fiscalFieldProvenance.findFirst({ where: { field: 'rbt12' }, select: { evidence: true } }),
    ]);
    const evidence = rbtProv?.evidence as { conferencia?: unknown } | null | undefined;
    return buildTaxOverview({
      regime: (settings?.taxRegime as Regime | null | undefined) ?? null,
      rbt12: p?.rbt12 == null ? null : new Prisma.Decimal(p.rbt12).toFixed(2),
      asOf: new Date().toISOString().slice(0, 10),
      conferencia: evidence?.conferencia ?? null,
      iss: { ibge: settings?.municipalityIbge ?? null, item: settings?.lc116Item ?? null, saved: settings?.issRate == null ? null : new Prisma.Decimal(settings.issRate).toString() },
    });
  }

  async saveTaxProfile(input: z.input<typeof TaxProfileSchema>, userId: string | null = null) {
    const saved = await this.prisma.$transaction(async (tx) => {
      const prev = await tx.tenantTaxProfile.findFirst();
      // O que a pessoa muda vira MANUAL: o preenchimento automático não sobrescreve mais (docs/specs/fiscal-autofill.md §4).
      const manual = (['rbt12', 'icmsSalePct', 'stateTaxRegular'] as AutofillField[]).filter(
        (k) => (input as Record<string, unknown>)[k] !== undefined && !sameValue((prev as Record<string, unknown> | null)?.[k], (input as Record<string, unknown>)[k]),
      );
      await markManual(tx, TenantContext.require(), manual, userId);
      const changed =
        !prev ||
        ['rbt12', 'icmsSalePct', 'simplesEffectiveRatePct', 'icmsSharePct', 'pisSharePct', 'cofinsSharePct'].some((k) => {
          const before = (prev as unknown as Record<string, Prisma.Decimal | null>)[k];
          const after = (input as unknown as Record<string, number | null | undefined>)[k];
          return (before?.toString() ?? null) !== (after === null || after === undefined ? null : new Prisma.Decimal(after).toString());
        });
      // Mudou um percentual: a validação do contador deixa de valer e precisa ser refeita.
      const data = { ...input, rbt12: input.rbt12 ?? null, icmsSalePct: input.icmsSalePct ?? null, rbt12AsOf: input.rbt12AsOf ? new Date(`${input.rbt12AsOf}T00:00:00Z`) : null, ...(changed ? { reviewedAt: null, reviewedBy: null } : {}) };
      return prev ? tx.tenantTaxProfile.update({ where: { orgId: prev.orgId }, data }) : tx.tenantTaxProfile.create({ data });
    });
    return { profile: this.profileView(saved) };
  }

  async reviewTaxProfile(input: z.infer<typeof ReviewSchema>) {
    const saved = await this.prisma.$transaction(async (tx) => {
      const prev = await tx.tenantTaxProfile.findFirst();
      if (!prev || (prev.simplesEffectiveRatePct === null && prev.rbt12 === null && prev.icmsSalePct === null)) throw new ConflictException('Informe a RBT12, a alíquota efetiva ou o ICMS da venda antes de validar o perfil');
      return tx.tenantTaxProfile.update({ where: { orgId: prev.orgId }, data: { reviewedBy: input.reviewedBy, reviewedAt: new Date() } });
    });
    return { profile: this.profileView(saved) };
  }

  private profileView(p: Prisma.TenantTaxProfileGetPayload<object>) {
    return {
      rbt12: p.rbt12?.toString() ?? null,
      icmsSalePct: p.icmsSalePct?.toString() ?? null,
      rbt12AsOf: p.rbt12AsOf?.toISOString().slice(0, 10) ?? null,
      simplesEffectiveRatePct: p.simplesEffectiveRatePct?.toString() ?? null,
      icmsSharePct: p.icmsSharePct?.toString() ?? null,
      pisSharePct: p.pisSharePct?.toString() ?? null,
      cofinsSharePct: p.cofinsSharePct?.toString() ?? null,
      requireTaxConfirmation: p.requireTaxConfirmation,
      stateTaxRegular: p.stateTaxRegular,
      reviewedBy: p.reviewedBy,
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
      rulesVersion: TAX_RULES_VERSION,
    };
  }

  // ---- nota ----

  /** Plano de preços de uma nota ainda não lançada: o que a tela mostra e o que o lançamento aplicaria. */
  async preview(invoiceId: string) {
    const cp = await this.profile();
    return this.prisma.$transaction(async (tx) => {
      await this.requireEditable(tx, invoiceId);
      return toDto(await buildPricingPlan(tx, invoiceId, undefined, cp));
    });
  }

  /** Grava o preço escolhido para um item (null = voltar a aceitar a sugestão) e devolve o plano recalculado. */
  async saveDraft(invoiceId: string, itemNumber: number, input: z.infer<typeof DraftSchema>) {
    const cp = await this.profile();
    return this.prisma.$transaction(async (tx) => {
      await this.requireEditable(tx, invoiceId);
      const item = await tx.purchaseInvoiceItem.findUnique({ where: { invoiceId_itemNumber: { invoiceId, itemNumber } }, select: { id: true, partId: true, resolution: true } });
      if (!item) throw new NotFoundException('Item não encontrado');
      if (!item.partId || item.resolution === 'IGNORED') throw new ConflictException('Vincule o item a uma peça antes de definir o preço');
      await tx.purchaseInvoiceItem.update({
        where: { id: item.id },
        // Mudar o preço invalida o "estou ciente" dado antes: a ciência vale para o preço que a pessoa viu.
        data: { draftSellPrice: input.sellPrice, priceAck: input.sellPrice === null ? false : (input.ack ?? false) },
      });
      return toDto(await buildPricingPlan(tx, invoiceId, undefined, cp));
    });
  }

  /** Ação em lote: aceitar todas as sugestões (grava como escolha) ou largar todas as escolhas e voltar às sugestões. */
  async bulk(invoiceId: string, input: z.infer<typeof BulkSchema>) {
    const cp = await this.profile();
    return this.prisma.$transaction(async (tx) => {
      await this.requireEditable(tx, invoiceId);
      const plan = await buildPricingPlan(tx, invoiceId, undefined, cp);
      for (const r of plan.rows) {
        if (input.action === 'CLEAR_DRAFTS') {
          if (r.draft) await tx.purchaseInvoiceItem.update({ where: { id: r.itemId }, data: { draftSellPrice: null, priceAck: false } });
        } else if (!r.draft && r.suggested && !r.locked) {
          await tx.purchaseInvoiceItem.update({ where: { id: r.itemId }, data: { draftSellPrice: r.suggested, priceAck: false } });
        }
      }
      return toDto(await buildPricingPlan(tx, invoiceId, undefined, cp));
    });
  }

  /** Últimas mudanças de custo e preço da peça (de notas lançadas com preço). */
  async history(partId: string) {
    const rows = await this.prisma.partPriceHistory.findMany({ where: { partId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return {
      history: rows.map((h) => ({
        at: h.createdAt.toISOString(),
        source: h.source,
        costBefore: h.costBefore?.toString() ?? null,
        costAfter: h.costAfter.toString(),
        sellBefore: h.sellBefore?.toString() ?? null,
        sellAfter: h.sellAfter.toString(),
        marginAfter: h.marginAfter?.toDecimalPlaces(2).toString() ?? null,
        saleTaxPct: h.saleTaxPct?.toString() ?? null,
        taxRulesVersion: h.taxRulesVersion,
      })),
    };
  }

  /**
   * Entradas da peça no estoque por nota, com a fotografia de cada lançamento (docs/specs/stock-entry-snapshot.md).
   * `intact` recalcula o hash sobre o que está gravado: false indica conteúdo alterado fora do sistema.
   */
  async entries(partId: string) {
    const rows = await this.prisma.stockEntrySnapshot.findMany({ where: { partId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return {
      entries: rows.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        quantity: e.quantity.toString(),
        unitCost: e.unitCost.toString(),
        totalCost: e.totalCost.toString(),
        avgCostAfter: e.avgCostAfter.toString(),
        sellPriceAfter: e.sellPriceAfter.toString(),
        priceChanged: e.priceChanged,
        taxRulesVersion: e.taxRulesVersion,
        schemaVersion: e.schemaVersion,
        intact: hashContext(e.context) === e.contentHash,
        context: e.context,
      })),
    };
  }

  private async requireEditable(tx: Prisma.TransactionClient, invoiceId: string) {
    const inv = await tx.purchaseInvoice.findUnique({ where: { id: invoiceId }, select: { status: true, exportStatus: true } });
    if (!inv) throw new NotFoundException('Nota não encontrada');
    if (inv.status !== 'FULL' || !EDITABLE.includes(inv.exportStatus)) throw new ConflictException('Esta nota não está em conciliação: os preços já não podem ser alterados');
  }

  // ---- peça ----

  async setPricingMode(partId: string, mode: 'AUTO' | 'MANUAL') {
    await this.updatePart(partId, { pricingMode: mode });
    return { partId, pricingMode: mode };
  }

  /**
   * Confirma o enquadramento da peça. Só a resposta completa (ST e monofásico) vale como confirmação; "não sei" nas duas
   * desfaz a confirmação e o cálculo volta a ler o XML. Meia resposta é recusada: confirmaria o que ninguém respondeu.
   */
  async setTaxFlags(partId: string, input: z.infer<typeof TaxFlagsSchema>) {
    const unknownSt = input.icmsStStatus === 'UNKNOWN';
    const unknownMono = input.pisCofinsMonofasico === null;
    if (unknownSt && unknownMono) {
      await this.updatePart(partId, { icmsStStatus: 'UNKNOWN', pisCofinsMonofasico: null, taxFlagsSource: null });
      return { partId, ...input, taxFlagsSource: null };
    }
    if (unknownSt || unknownMono) throw new BadRequestException('Responda se a peça tem ST e se é monofásica, ou marque "não sei" nas duas para desfazer a confirmação');
    await this.updatePart(partId, { icmsStStatus: input.icmsStStatus, pisCofinsMonofasico: input.pisCofinsMonofasico, taxFlagsSource: 'MANUAL' });
    return { partId, ...input, taxFlagsSource: 'MANUAL' as const };
  }

  private async updatePart(partId: string, data: Prisma.PartUpdateInput) {
    try {
      await this.prisma.part.update({ where: { id: partId }, data });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') throw new NotFoundException('Peça não encontrada');
      throw e;
    }
  }
}
