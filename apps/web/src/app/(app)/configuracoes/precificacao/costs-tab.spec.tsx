// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expenseBody, expenseSummary, formFromExpense, monthlyOf, type CostExpense, type CostsOverview } from '@/lib/costs';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), putJson: vi.fn(), deleteJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { CostsTab } from './costs-tab';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const aluguel: CostExpense = {
  id: 'e1', categoryCode: 'OCUPACAO.ALUGUEL', name: 'Aluguel', kind: 'FIXED', amount: '6500.0000', pct: null, recurrence: 'MONTHLY', amortizeMonths: null,
  effectiveFrom: '2026-01-01', effectiveTo: null, allocations: [{ costCenter: 'PECAS', pct: '100' }], appliesTo: null, version: 1,
};
const data = (o: Partial<Extract<CostsOverview, { enabled: true }>> = {}): CostsOverview => ({
  enabled: true,
  cnpj: '11222333000181',
  expenses: [aluguel, { ...aluguel, id: 'e2', categoryCode: 'VENDAS.CARTAO', name: 'Maquininha', kind: 'SALE_PCT', amount: null, pct: '3.5000', allocations: [], appliesTo: { paymentMethods: ['CREDITO_1X'] } }],
  categories: [
    { code: 'OCUPACAO.ALUGUEL', name: 'Aluguel', defaultKind: 'FIXED' },
    { code: 'VENDAS.CARTAO', name: 'Taxa da maquininha', defaultKind: 'SALE_PCT' },
  ],
  channels: [
    { code: 'BALCAO', name: 'Venda no balcão', costCenter: 'PECAS' },
    { code: 'OS_SERVICOS', name: 'Mão de obra na ordem de serviço', costCenter: 'SERVICOS' },
  ],
  costCenters: [
    { code: 'PECAS', name: 'Peças (balcão e OS)', kind: 'PRODUCTIVE', allocation: 'REVENUE_PCT' },
    { code: 'SERVICOS', name: 'Oficina (mão de obra)', kind: 'PRODUCTIVE', allocation: 'HOURLY' },
  ],
  profile: {
    version: 3, period: '2026-09', confidence: 'ESTIMADO', warnings: ['OCUPACAO_PADRAO'], publishedAt: '2026-10-01T00:00:00Z',
    centers: {
      PECAS: { code: 'PECAS', fixedMonthly: '30000.00', revenueBase: '200000.00', monthsOfData: 12, fixedPct: '15.0000', productiveHours: null, hourlyCost: null, warnings: [] },
      SERVICOS: { code: 'SERVICOS', fixedMonthly: '30000.00', revenueBase: null, monthsOfData: 12, fixedPct: null, productiveHours: '396.00', hourlyCost: '75.7576', warnings: ['OCUPACAO_PADRAO'] },
    },
    channels: { BALCAO: { code: 'BALCAO', costCenter: 'PECAS', allocation: 'REVENUE_PCT', fixedPct: '15.0000', variablePct: '4.1000', financialPct: '0.0000', warnings: [] } },
  },
  settings: { paymentMix: null, mechanics: 3, hoursPerMechanic: 176, partsRevenueGoal: null, lastSyncAt: null, lastPublishedVersion: 3 },
  ...o,
});
const mount = (d: CostsOverview | null) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CostsTab data={d} canEdit />
    </QueryClientProvider>,
  );

describe('lib/costs', () => {
  it('resumo e mensal equivalente de cada tipo de despesa', () => {
    expect(expenseSummary(aluguel)).toMatch(/R\$\s?6\.500,00 por mês/);
    expect(expenseSummary({ ...aluguel, recurrence: 'ANNUAL', amount: '2400' })).toMatch(/por ano \(÷ 12\)/);
    expect(expenseSummary({ ...aluguel, kind: 'SALE_PCT', pct: '3.5' })).toBe('3,5% de cada venda');
    expect(monthlyOf({ ...aluguel, recurrence: 'ANNUAL', amount: '2400' })).toBe(200);
    expect(monthlyOf({ ...aluguel, recurrence: 'ONE_OFF_AMORTIZED', amount: '12000', amortizeMonths: 24 })).toBe(500);
    expect(monthlyOf({ ...aluguel, kind: 'SALE_PCT' })).toBe(0);
  });

  it('o formulário vira o corpo do cost-engine: fixa vai com o centro; % vai com canais e formas de pagamento', () => {
    expect(expenseBody(formFromExpense(aluguel))).toMatchObject({ kind: 'FIXED', amount: 6500, pct: null, allocations: [{ costCenter: 'PECAS', pct: 100 }], appliesTo: null });
    const card = expenseBody({ ...formFromExpense(aluguel), kind: 'SALE_PCT', value: '3,5', channels: ['BALCAO'], paymentMethods: ['CREDITO_1X'] });
    expect(card).toMatchObject({ amount: null, pct: 3.5, allocations: [], appliesTo: { channels: ['BALCAO'], paymentMethods: ['CREDITO_1X'] } });
  });
});

describe('CostsTab', () => {
  it('motor desligado: explica, sem erro', () => {
    mount({ enabled: false });
    expect(screen.getByText(/motor de custos ainda não está ligado/)).toBeTruthy();
  });

  it('mostra o perfil vigente: estrutura, despesas de venda, custo da hora e os avisos em português', () => {
    mount(data());
    expect(screen.getByText(/versão 3/)).toBeTruthy();
    expect(screen.getByText('Estrutura nas peças').nextSibling!.textContent).toBe('15%');
    expect(screen.getByText(/Despesas de venda/).nextSibling!.textContent).toBe('4,1%');
    expect(screen.getByText('Custo da hora da oficina').nextSibling!.textContent).toMatch(/75,76/);
    expect(screen.getByText(/supõe 75% das horas disponíveis/)).toBeTruthy();
  });

  it('lista as despesas por categoria com o total fixo do mês', () => {
    mount(data());
    expect(screen.getByText(/Fixas: R\$\s?6\.500,00 por mês/)).toBeTruthy();
    expect(screen.getByText('Taxa da maquininha')).toBeTruthy();
    expect(screen.getByText('3,5% de cada venda')).toBeTruthy();
  });

  it('nova despesa: valida, monta o corpo e recarrega', async () => {
    api.postJson.mockResolvedValue({});
    mount(data());
    await userEvent.click(screen.getByRole('button', { name: /Nova despesa/ }));
    const sheet = screen.getByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Adicionar' }));
    expect(within(sheet).getByText('Dê um nome à despesa')).toBeTruthy();
    expect(api.postJson).not.toHaveBeenCalled();

    await userEvent.type(within(sheet).getByLabelText('Nome'), 'Contador');
    await userEvent.type(within(sheet).getByLabelText('Valor'), '900');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Adicionar' }));
    expect(api.postJson).toHaveBeenCalledWith('/api/costs/expenses', expect.objectContaining({ name: 'Contador', kind: 'FIXED', amount: 900, allocations: [{ costCenter: 'PECAS', pct: 100 }] }), expect.any(String));
    expect(refresh).toHaveBeenCalled();
  });

  it('mix de pagamento precisa somar 100%', async () => {
    mount(data());
    await userEvent.type(screen.getByLabelText('PIX'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText(/O mix soma 50%: precisa dar 100%/)).toBeTruthy();
    expect(api.putJson).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Crédito à vista'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(api.putJson).toHaveBeenCalledWith('/api/costs/settings', expect.objectContaining({ paymentMix: { PIX: 50, CREDITO_1X: 50 }, mechanics: 3, hoursPerMechanic: 176 }), expect.any(String));
  });

  it('atualizar mostra o rascunho com o impacto; só publica quando a pessoa pede', async () => {
    const d = data();
    if (!d.enabled) throw new Error();
    api.postJson.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/sync')
          ? { months: 12, ordersCounted: 40, actualsSent: 7, basedOnVersion: 3, profile: { ...d.profile!, warnings: [] }, impact: [{ channel: 'BALCAO', beforePp: '19.10', afterPp: '21.10', deltaPp: '2.00' }] }
          : { version: 4 },
      ),
    );
    mount(d);
    await userEvent.click(screen.getByRole('button', { name: /Atualizar com as OS/ }));
    expect(await screen.findByText(/Contadas 40 OS concluídas e 7 contas pagas em 12 meses/)).toBeTruthy();
    expect(screen.getByText(/Venda no balcão: 19,1% →/).textContent).toMatch(/21,1% do preço \(\+2%\)/);
    expect(api.postJson).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /Publicar este perfil/ }));
    expect(api.postJson).toHaveBeenLastCalledWith('/api/costs/publish', {}, expect.any(String));
    expect(refresh).toHaveBeenCalled();
  });
});
