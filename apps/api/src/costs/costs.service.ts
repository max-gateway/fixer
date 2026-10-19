import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@fixer/db';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { CostEngineClient } from './cost-engine.client.js';
import { aggregateOrders, buildMetrics, categorize, CENTER_PARTS, closedMonths, isExpensePayable, monthStart, PAYMENT_METHODS, periodOf, type PaymentMethod } from './sync.js';

// Ponte do Fixer com o motor de custos (docs/specs/cost-engine.md §14, fase 1): a oficina é uma empresa (CNPJ) no
// cost-engine; o Fixer garante o cadastro, manda as métricas das OS e as contas pagas, e repassa as despesas da tela.

export const CostSettingsSchema = z.object({
  paymentMix: z
    .record(z.enum(PAYMENT_METHODS), z.number().min(0).max(100))
    .nullable()
    .default(null)
    .refine((m) => !m || Object.keys(m).length === 0 || Math.abs(Object.values(m).reduce((s, v) => s + v, 0) - 100) < 0.5, 'O mix de pagamento deve somar 100%'),
  mechanics: z.number().int().min(0).max(200).nullable().default(null),
  hoursPerMechanic: z.number().min(0).max(744).nullable().default(null),
  partsRevenueGoal: z.number().min(0).max(1_000_000_000).nullable().default(null),
});

/** O corpo da despesa é validado pelo cost-engine (que devolve os detalhes); aqui só o formato geral. */
export const ExpenseBodySchema = z.record(z.unknown());

type Profile = { version: number; period: string; confidence: string; warnings: string[]; centers: Record<string, unknown>; channels: Record<string, unknown>; publishedAt: string };

@Injectable()
export class CostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: CostEngineClient,
  ) {}

  /** CNPJ da oficina no cost-engine; sem CNPJ cadastrado não há empresa para ratear. */
  private async cnpj(): Promise<{ cnpj: string; name: string }> {
    const s = await this.prisma.tenantFiscalSettings.findFirst({ select: { cnpj: true, legalName: true } });
    if (!s?.cnpj) throw new ConflictException('Cadastre o CNPJ da oficina em Cadastro da oficina antes de configurar os custos.');
    return { cnpj: s.cnpj, name: s.legalName || `Oficina ${s.cnpj}` };
  }

  private async settings() {
    return this.prisma.costSettings.findFirst();
  }

  /** Garante a empresa e o modelo "oficina" no cost-engine (uma vez; o modelo é idempotente do lado de lá). */
  private async ensure(): Promise<string> {
    const { cnpj, name } = await this.cnpj();
    await this.engine.request('PUT', `/v1/companies/${cnpj}`, { name });
    const s = await this.settings();
    if (!s?.templateApplied) {
      await this.engine.request('POST', `/v1/companies/${cnpj}/categories/apply-template`, { template: 'oficina' });
      await this.upsertSettings({ templateApplied: true });
    }
    return cnpj;
  }

  private upsertSettings(data: Prisma.CostSettingsUpdateInput & Prisma.CostSettingsCreateInput) {
    return this.prisma.costSettings.findFirst().then((prev) => (prev ? this.prisma.costSettings.update({ where: { orgId: prev.orgId }, data }) : this.prisma.costSettings.create({ data })));
  }

  private settingsView(s: Awaited<ReturnType<CostsService['settings']>>) {
    return {
      paymentMix: (s?.paymentMix as Partial<Record<PaymentMethod, number>> | null) ?? null,
      mechanics: s?.mechanics ?? null,
      hoursPerMechanic: s?.hoursPerMechanic ? Number(s.hoursPerMechanic) : null,
      partsRevenueGoal: s?.partsRevenueGoal ? Number(s.partsRevenueGoal) : null,
      lastSyncAt: s?.lastSyncAt?.toISOString() ?? null,
      lastPublishedVersion: s?.lastPublishedVersion ?? null,
    };
  }

  /** Tudo o que a tela "Despesas" mostra numa chamada. Sem motor configurado, diz isso em vez de falhar a página. */
  async overview() {
    if (!this.engine.enabled) return { enabled: false as const };
    const cnpj = await this.ensure();
    const base = `/v1/companies/${cnpj}`;
    const [expenses, categories, channels, centers, profile, s] = await Promise.all([
      this.engine.request<{ expenses: unknown[] }>('GET', `${base}/expenses`),
      this.engine.request<{ categories: unknown[] }>('GET', `${base}/categories`),
      this.engine.request<{ channels: unknown[] }>('GET', `${base}/channels`),
      this.engine.request<{ costCenters: unknown[] }>('GET', `${base}/cost-centers`),
      this.engine.find<Profile>(`${base}/profiles/current`),
      this.settings(),
    ]);
    return { enabled: true as const, cnpj, expenses: expenses.expenses, categories: categories.categories, channels: channels.channels, costCenters: centers.costCenters, profile, settings: this.settingsView(s) };
  }

  async saveSettings(input: z.infer<typeof CostSettingsSchema>) {
    const saved = await this.upsertSettings({
      paymentMix: input.paymentMix ?? Prisma.DbNull,
      mechanics: input.mechanics,
      hoursPerMechanic: input.hoursPerMechanic,
      partsRevenueGoal: input.partsRevenueGoal,
    });
    return { settings: this.settingsView(saved) };
  }

  async createExpense(body: unknown, actor: string) {
    const cnpj = await this.ensure();
    return this.engine.request('POST', `/v1/companies/${cnpj}/expenses`, body, actor);
  }

  async updateExpense(id: string, body: unknown, actor: string) {
    const cnpj = await this.ensure();
    return this.engine.request('PUT', `/v1/companies/${cnpj}/expenses/${encodeURIComponent(id)}`, body, actor);
  }

  async deleteExpense(id: string, actor: string) {
    const cnpj = await this.ensure();
    await this.engine.request('DELETE', `/v1/companies/${cnpj}/expenses/${encodeURIComponent(id)}`, undefined, actor);
  }

  /**
   * Manda ao cost-engine os 12 meses fechados (métricas das OS e contas pagas) e devolve o rascunho do perfil com o impacto.
   * Nada é publicado: a pessoa confere o impacto e publica.
   */
  async sync(now = new Date()) {
    const cnpj = await this.ensure();
    const base = `/v1/companies/${cnpj}`;
    const months = closedMonths(now, 12);
    const from = monthStart(months[0]!);
    const to = monthStart(periodOf(now));
    const s = await this.settings();

    const orders = await this.prisma.serviceOrder.findMany({
      where: { status: { in: ['COMPLETED', 'DELIVERED'] }, closedAt: { gte: from, lt: to } },
      select: { closedAt: true, partLines: { select: { quantity: true, unitPrice: true } }, serviceLines: { select: { price: true, hoursActual: true } } },
    });
    // `closedAt` existe em toda OS concluída (o filtro garante); o cast só estreita o tipo.
    const totals = aggregateOrders(orders as { closedAt: Date; partLines: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }[]; serviceLines: { price: Prisma.Decimal; hoursActual: Prisma.Decimal | null }[] }[]);
    const metrics = buildMetrics(months, totals, {
      paymentMix: (s?.paymentMix as Partial<Record<PaymentMethod, number>> | null) ?? null,
      mechanics: s?.mechanics ?? null,
      hoursPerMechanic: s?.hoursPerMechanic != null ? new Prisma.Decimal(s.hoursPerMechanic) : null,
    });
    for (const m of metrics) await this.engine.request('PUT', `${base}/metrics/${m.period}/${m.costCenter}`, m.body);

    const paid = await this.prisma.payable.findMany({
      where: { status: 'PAID', paidAt: { gte: from, lt: to } },
      select: { id: true, source: true, category: true, paidAmount: true, amount: true, paidAt: true },
    });
    const actuals = paid.filter(isExpensePayable).map((p) => ({
      externalId: `payable:${p.id}`,
      period: periodOf(p.paidAt!),
      categoryCode: categorize(p.category),
      amount: (p.paidAmount ?? p.amount).toFixed(2),
    }));
    for (let i = 0; i < actuals.length; i += 1000) await this.engine.request('POST', `${base}/actuals`, { items: actuals.slice(i, i + 1000) });

    await this.upsertSettings({ lastSyncAt: new Date() });
    const draft = await this.engine.request<{ profile: Profile; basedOnVersion: number | null; impact: unknown[] }>('POST', `${base}/profiles/draft`, this.basis(months, s));
    return { months: months.length, ordersCounted: orders.length, actualsSent: actuals.length, ...draft };
  }

  /** Publica o perfil do último mês fechado; o preço passa a usar esta versão. */
  async publish(actor: string, now = new Date()) {
    const cnpj = await this.ensure();
    const months = closedMonths(now, 12);
    const profile = await this.engine.request<Profile>('POST', `/v1/companies/${cnpj}/profiles/publish`, this.basis(months, await this.settings()), actor);
    await this.upsertSettings({ lastPublishedVersion: profile.version });
    return profile;
  }

  /** Janela de 12 meses; a meta de faturamento de peças vira a base enquanto não há 3 meses de histórico. */
  private basis(months: string[], s: Awaited<ReturnType<CostsService['settings']>>) {
    const goal = s?.partsRevenueGoal && Number(s.partsRevenueGoal) > 0 ? s.partsRevenueGoal.toFixed(2) : null;
    return { period: months[months.length - 1]!, basis: { window: 'TTM', ...(goal ? { budgetRevenue: { [CENTER_PARTS]: goal } } : {}) } };
  }
}
