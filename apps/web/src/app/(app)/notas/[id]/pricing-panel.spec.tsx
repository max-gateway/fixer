// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PricingPlanView, PricingRowView, SaleTaxView } from '@/lib/pricing';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), putJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PricingPanel } from './pricing-panel';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const rule = { method: 'MARGIN' as const, value: '30', overheadPct: '0', rounding: 'CENTS_90', minMarginPct: '20', maxJumpPct: '25' };
const tax = (o: Partial<SaleTaxView> = {}): SaleTaxView => ({ pct: '5.65', confidence: 'ESTIMADO', unavailable: null, components: [], ...o });
const row = (n: number, o: Partial<PricingRowView> = {}) =>
  ({
    itemNumber: n, partId: `p${n}`, sku: `SKU-${n}`, name: `Peça ${n}`, stockQty: '2', cost: '100', previousCost: null, currentPrice: '150', ruleId: 'r', ruleScope: 'DEFAULT', rule,
    saleTax: tax(), taxNotes: [], suggested: '160.9', draft: null, proposed: '160.9', marginPct: '30', markupPct: '60', flags: [], blocking: [], ack: false, error: null, locked: false, ...o,
  }) as unknown as PricingRowView;

const plan = (rows: PricingRowView[], o: Partial<PricingPlanView> = {}): PricingPlanView => ({
  rulesVersion: 'v', regime: 'SIMPLES', hasRule: true, rule, requireTaxConfirmation: false, rows,
  taxReadiness: { ready: true, supported: true, regime: 'SIMPLES', summary: '', missing: [] }, ...o,
});

function mount(p: PricingPlanView) {
  api.getJson.mockResolvedValue(p);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PricingPanel invoiceId="inv1" ready />
    </QueryClientProvider>,
  );
}

const SIX = [
  row(1),
  row(2, { flags: ['BELOW_MIN_MARGIN'], blocking: ['BELOW_MIN_MARGIN'] }),
  row(3),
  row(4, { saleTax: tax({ pct: null, unavailable: 'SEM_ALIQUOTA' }), flags: ['TAX_UNAVAILABLE'] }),
  row(5),
  row(6, { taxNotes: [{ code: 'MONOFASICO_NA_LISTA_SEM_XML', text: 'x' }] }),
];

describe('PricingPanel', () => {
  it('mostra o esqueleto enquanto calcula', () => {
    api.getJson.mockReturnValue(new Promise(() => {}));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PricingPanel invoiceId="inv1" ready />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('Calculando os preços').getAttribute('aria-busy')).toBe('true');
  });

  it('lista as peças numa tabela semântica com os cabeçalhos das colunas', async () => {
    mount(plan(SIX));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Peça', 'Custo real', 'Imposto', 'Novo preço', 'Margem']);
    expect(within(table).getAllByRole('row')).toHaveLength(7); // cabeçalho + 6 peças
  });

  it('o campo de preço leva a unidade R$ e o rótulo da peça', async () => {
    mount(plan([row(1)]));
    const input = (await screen.findByLabelText('Novo preço de venda')) as HTMLInputElement;
    expect(input.value).toBe('160,9');
    expect(screen.getAllByText('R$').length).toBeGreaterThan(0);
  });

  it('com 5 peças ou mais e algum alerta, aparece o filtro com as contagens e ele filtra de verdade', async () => {
    mount(plan(SIX));
    const group = await screen.findByRole('radiogroup', { name: 'Filtrar itens' });
    expect(within(group).getByRole('radio', { name: 'Todos (6)' })).toBeTruthy();
    await userEvent.click(within(group).getByRole('radio', { name: 'Com alerta (3)' })); // item 2 (alerta), 4 (sem imposto) e 6 (aviso fiscal)
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByText('Peça 1')).toBeNull();
    expect(screen.getByText('Peça 2')).toBeTruthy();
    await userEvent.click(within(group).getByRole('radio', { name: 'Sem imposto (1)' }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Peça 4')).toBeTruthy();
    await userEvent.click(within(group).getByRole('radio', { name: 'Todos (6)' }));
    expect(screen.getAllByRole('row')).toHaveLength(7);
  });

  it('nota pequena ou sem alertas não mostra o filtro', async () => {
    mount(plan([row(1), row(2)]));
    await screen.findByRole('table');
    expect(screen.queryByRole('radiogroup', { name: 'Filtrar itens' })).toBeNull();
  });

  it('o aviso fiscal do item aparece no link Detalhes', async () => {
    mount(plan(SIX));
    await screen.findByRole('table');
    expect(screen.getByText('1 aviso fiscal para conferir')).toBeTruthy();
  });

  it('lançar pede confirmação num AlertDialog; Voltar não grava e confirmar grava', async () => {
    api.postJson.mockResolvedValue({});
    mount(plan([row(1, { currentPrice: '100' })]));
    await userEvent.click(await screen.findByRole('button', { name: /Lançar entrada e atualizar preços/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Lançar a entrada e atualizar os preços?')).toBeTruthy();
    expect(within(dialog).getByText('Peça 1')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.postJson).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Lançar entrada e atualizar preços/ }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /Lançar e atualizar preços/ }));
    await waitFor(() => expect(api.postJson).toHaveBeenCalledWith('/api/invoices/inv1/confirm-with-pricing', {}, expect.any(String)));
  });

  it('itens com alerta que bloqueia desativam o lançamento', async () => {
    mount(plan([row(1, { flags: ['BELOW_COST'], blocking: ['BELOW_COST'] })]));
    expect(((await screen.findByRole('button', { name: /Lançar entrada e atualizar preços/ })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('aviso do topo some quando o imposto está pronto e reaparece com o que falta', async () => {
    const { unmount } = mount(plan([row(1)]));
    await screen.findByRole('table');
    expect(screen.queryByText('Imposto estimado.')).toBeNull();
    unmount();
    mount(plan([row(1)], { taxReadiness: { ready: false, supported: true, regime: 'SIMPLES', summary: '', missing: [{ id: 'dados', label: 'Receita dos últimos 12 meses (RBT12)', detail: '', tableId: null }] } }));
    expect(await screen.findByText('Imposto estimado.')).toBeTruthy();
  });
});
