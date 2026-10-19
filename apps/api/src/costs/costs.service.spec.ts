import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@fixer/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CostEngineClient, CostEngineConfig } from './cost-engine.client.js';
import { CostsService } from './costs.service.js';
import { closedMonths } from './sync.js';

/** Banco do Fixer em memória: só o que o CostsService lê e grava. */
function fakePrisma(o: { cnpj: string | null; orders?: unknown[]; payables?: unknown[] }) {
  let settings: Record<string, unknown> | null = null;
  return {
    tenantFiscalSettings: { findFirst: async () => (o.cnpj ? { cnpj: o.cnpj, legalName: 'Oficina Teste Ltda' } : null) },
    costSettings: {
      findFirst: async () => settings,
      create: async ({ data }: { data: Record<string, unknown> }) => (settings = { orgId: 'org', templateApplied: false, ...data }),
      update: async ({ data }: { data: Record<string, unknown> }) => (settings = { ...settings, ...data }),
    },
    serviceOrder: { findMany: async () => o.orders ?? [] },
    payable: { findMany: async () => o.payables ?? [] },
  };
}

function service(prisma: unknown, env: { url?: string; key?: string }) {
  const prev = { url: process.env.COST_ENGINE_URL, key: process.env.COST_ENGINE_API_KEY };
  process.env.COST_ENGINE_URL = env.url ?? '';
  process.env.COST_ENGINE_API_KEY = env.key ?? '';
  const cfg = new CostEngineConfig();
  process.env.COST_ENGINE_URL = prev.url;
  process.env.COST_ENGINE_API_KEY = prev.key;
  return new CostsService(prisma as never, new CostEngineClient(cfg));
}

describe('CostsService sem motor configurado', () => {
  it('a tela recebe "desligado" em vez de erro; gravar pede a configuração', async () => {
    const s = service(fakePrisma({ cnpj: '11222333000181' }), {});
    expect(await s.overview()).toEqual({ enabled: false });
    await expect(s.createExpense({}, 'ana')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

/**
 * Contrato real com o cost-engine (max-gateway/platform services/cost-engine): o serviço do Fixer contra o motor rodando.
 * Só roda com COST_ENGINE_TEST_URL e COST_ENGINE_TEST_KEY (um cost-engine de teste, com banco descartável).
 */
const URL = process.env.COST_ENGINE_TEST_URL;
const KEY = process.env.COST_ENGINE_TEST_KEY;

describe.skipIf(!URL || !KEY)('CostsService ↔ cost-engine (contrato, integração)', () => {
  // CNPJ diferente a cada execução: o banco do motor de teste acumula empresas entre execuções.
  const cnpj = `${Date.now().toString(36).toUpperCase().padStart(12, '0').slice(-12)}00`;
  const NOW = new Date('2026-10-19T12:00:00Z');
  const months = closedMonths(NOW, 12);
  const orders = months.map((p) => ({
    closedAt: new Date(`${p}-15T15:00:00Z`),
    partLines: [{ quantity: new Prisma.Decimal(1), unitPrice: new Prisma.Decimal(200000) }],
    serviceLines: [{ price: new Prisma.Decimal(10000), hoursActual: new Prisma.Decimal(300) }],
  }));
  const payables = [
    { id: 'p1', source: 'MANUAL', category: 'Aluguel', amount: new Prisma.Decimal(21000), paidAmount: new Prisma.Decimal(21000), paidAt: new Date('2026-09-05T12:00:00Z') },
    { id: 'p2', source: 'XML_INSTALLMENT', category: null, amount: new Prisma.Decimal(5000), paidAmount: null, paidAt: new Date('2026-09-06T12:00:00Z') },
    { id: 'p3', source: 'MANUAL', category: 'Tributos de entrada', amount: new Prisma.Decimal(300), paidAmount: null, paidAt: new Date('2026-09-07T12:00:00Z') },
  ];
  let s: CostsService;

  beforeAll(() => {
    s = service(fakePrisma({ cnpj, orders, payables }), { url: URL, key: KEY });
  });
  afterAll(() => undefined);

  it('cadastra a oficina e aplica o modelo na primeira visita', async () => {
    const o = await s.overview();
    expect(o).toMatchObject({ enabled: true, cnpj, profile: null });
    if (!o.enabled) throw new Error('motor desligado');
    expect((o.costCenters as { code: string }[]).map((c) => c.code)).toEqual(['ADM', 'PECAS', 'SERVICOS']);
    expect((o.channels as { code: string }[]).map((c) => c.code)).toEqual(['BALCAO', 'OS_PECAS', 'OS_SERVICOS']);
  });

  it('erro de validação do motor chega com o status e a mensagem dele', async () => {
    const err = await s
      .createExpense({ categoryCode: 'OCUPACAO.ALUGUEL', name: 'Aluguel', kind: 'FIXED', amount: 1, effectiveFrom: '2026-01-01', allocations: [{ costCenter: 'PECAS', pct: 50 }] }, 'ana@oficina')
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(400);
  });

  it('sincroniza 12 meses de OS e só as contas que são despesa; o rascunho tem a estrutura e o custo da hora', async () => {
    await s.saveSettings({ paymentMix: { PIX: 30, DINHEIRO: 10, CREDITO_1X: 25, CREDITO_PARCELADO: 35 }, mechanics: 2, hoursPerMechanic: 176, partsRevenueGoal: null });
    const add = (b: object) => s.createExpense({ effectiveFrom: '2025-01-01', ...b }, 'ana@oficina');
    await add({ categoryCode: 'OCUPACAO.ALUGUEL', name: 'Aluguel', kind: 'FIXED', amount: 21000, allocations: [{ costCenter: 'PECAS', pct: 100 }] });
    await add({ categoryCode: 'SERVICOS.CONTABILIDADE', name: 'Contador', kind: 'FIXED', amount: 9000, allocations: [{ costCenter: 'ADM', pct: 100 }] });
    await add({ categoryCode: 'VENDAS.CARTAO', name: 'Maquininha', kind: 'SALE_PCT', pct: 3.5, appliesTo: { paymentMethods: ['CREDITO_1X', 'CREDITO_PARCELADO'] } });
    await add({ categoryCode: 'VENDAS.COMISSAO', name: 'Comissão', kind: 'SALE_PCT', pct: 2, appliesTo: { channels: ['BALCAO'] } });

    const r = await s.sync(NOW);
    expect(r).toMatchObject({ months: 12, ordersCounted: 12, actualsSent: 1, basedOnVersion: null });
    expect(r.profile.period).toBe('2026-09');
    // administração (9.000) dividida pelo faturamento: 200.000 de peças e 10.000 de oficina
    const centers = r.profile.centers as Record<string, { fixedPct: string | null; hourlyCost: string | null; productiveHours: string | null }>;
    expect(centers.PECAS!.fixedPct).toBe('14.7857'); // (21.000 + 8.571,43) ÷ 200.000
    expect(centers.SERVICOS).toMatchObject({ productiveHours: '300.00', hourlyCost: '1.4286' }); // 428,57 ÷ 300 h vendidas
    expect((r.profile.channels as Record<string, { variablePct: string }>).BALCAO!.variablePct).toBe('4.1000');
  });

  it('publica e a tela passa a mostrar a versão vigente', async () => {
    const p = await s.publish('ana@oficina', NOW);
    expect(p.version).toBe(1);
    const o = await s.overview();
    if (!o.enabled) throw new Error('motor desligado');
    expect(o.profile).toMatchObject({ version: 1, period: '2026-09' });
    expect(o.settings).toMatchObject({ lastPublishedVersion: 1, mechanics: 2 });
  });

  it('sem CNPJ cadastrado: pede o CNPJ antes de tudo', async () => {
    const none = service(fakePrisma({ cnpj: null }), { url: URL, key: KEY });
    await expect(none.overview()).rejects.toThrow(/CNPJ/);
  });
});
