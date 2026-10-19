// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfidenceChip } from '@/components/confidence-chip';
import type { EntryView } from '@/lib/entries';
import type { PricingPlanView, PricingRowView } from '@/lib/pricing';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), putJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));

import { entryTaxPayableBody, EntryTaxPayable } from './entry-tax-payable';
import { PriceDetails } from './price-details';
import { CostProfileNote } from './pricing-panel';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const rule = { method: 'MARGIN' as const, value: '30', overheadPct: '4', rounding: 'CENTS_90', minMarginPct: '20', maxJumpPct: '25' };
const row = (o: Partial<PricingRowView> = {}) =>
  ({
    itemNumber: 1, partId: 'p1', sku: 'PAST', name: 'Pastilha', stockQty: '2', cost: '100', previousCost: null, currentPrice: '150', ruleScope: 'DEFAULT', rule,
    costComponents: [
      { code: 'PRODUTO', treatment: 'COST', amount: '86.2', source: 'vProd', allocated: false },
      { code: 'ICMS_ST_ENTRADA', treatment: 'COST', amount: '13.8', source: 'RICMS-PE', allocated: false },
    ],
    saleTax: { pct: '6', confidence: 'ESTIMADO', unavailable: null, components: [] }, taxNotes: [], suggested: '160.9', draft: null, proposed: '160', marginPct: '30', markupPct: '60',
    flags: [], blocking: [], ack: false, error: null, locked: false, ...o,
  }) as unknown as PricingRowView;
const plan = (r: PricingRowView): PricingPlanView => ({ rulesVersion: 'v', regime: 'SIMPLES', hasRule: true, rule, requireTaxConfirmation: false, rows: [r], taxReadiness: { ready: true, supported: true, regime: 'SIMPLES', summary: '', missing: [] } });

const entry: EntryView = {
  id: 's1', at: '2026-10-18T14:02:00Z', quantity: '10', unitCost: '23.2', totalCost: '232', avgCostAfter: '18.8', sellPriceAfter: '43.9', priceChanged: true, taxRulesVersion: 'a@1+b@2', schemaVersion: 1, intact: true,
  context: {
    document: { number: 123, series: 1, issuedAt: null, issuer: { name: 'Fornecedor X', uf: 'SP' } },
    stock: { quantity: '10', before: { costPrice: '10', avgCost: null }, after: { costPrice: '23.2', avgCost: '18.8' } },
    cost: { unit: '23.2', regime: 'SIMPLES', components: [{ code: 'PRODUTO', treatment: 'COST', amount: '232', source: 'vProd', allocated: false }] },
    price: { outcome: 'APPLIED', before: '40', after: '43.9', suggested: '43.9', marginPct: '41', rule: { method: 'MARGIN', value: '35', overheadPct: '4', minMarginPct: '20' } },
    saleTax: { pct: '6', confidence: 'ESTIMADO' },
  },
};

async function openDrawer(r: PricingRowView, entries: EntryView[]) {
  api.getJson.mockImplementation((url: string) => Promise.resolve(url.endsWith('/entries') ? { entries } : { history: [] }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PriceDetails plan={plan(r)} row={r} trigger={<button type="button">Detalhes</button>} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Detalhes' }));
}

describe('ConfidenceChip', () => {
  it('texto e estado sempre juntos (a cor nunca é o único sinal)', () => {
    const out = renderToStaticMarkup(<ConfidenceChip state="INVIAVEL" />);
    expect(out).toContain('Inviável');
    expect(out).toContain('data-confidence="INVIAVEL"');
    expect(renderToStaticMarkup(<ConfidenceChip state="ESTIMADO" label="Imposto estimado" />)).toContain('Imposto estimado');
  });
});

describe('PriceDetails (gaveta "Por que esse preço?")', () => {
  it('mostra a composição do custo, de cada R$ 100 do preço e os preços-limite', async () => {
    await openDrawer(row(), [entry]);
    expect(screen.getByText('ICMS-ST pago por você na entrada (PE)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /De cada R\$ 100 do preço de R\$\s?160,00/ })).toBeTruthy();
    // custo 100 de 160 = 62,5; imposto 6; despesas 4; margem 27,5
    expect(screen.getByText('Margem').closest('li')!.textContent).toMatch(/27,50/);
    // 100 ÷ (1 − 0,10) = 111,11; 100 ÷ (1 − 0,30) = 142,86
    expect(screen.getByText('Mínimo sem prejuízo').nextSibling!.textContent).toMatch(/111,11/);
    expect(screen.getByText(/Margem mínima/).nextSibling!.textContent).toMatch(/142,86/);
  });

  it('com perfil de custos: separa estrutura de despesas de venda e mostra o equilíbrio', async () => {
    await openDrawer(row({ overhead: { source: 'PROFILE', variablePct: '4', fixedPct: '15', extraUnitCost: '2' } }), []);
    // custo + extras 102 de 160 = 63,75; imposto 6; venda 4; estrutura 15; margem 11,25
    expect(screen.getByText('Custo + extras')).toBeTruthy();
    expect(screen.getByText('Estrutura da oficina').closest('li')!.textContent).toMatch(/15,00/);
    expect(screen.getByText('Margem').closest('li')!.textContent).toMatch(/11,25/);
    // 102 ÷ 0,90 = 113,33; 102 ÷ 0,75 = 136,00; 102 ÷ 0,55 = 185,45
    expect(screen.getByText('Mínimo sem prejuízo').nextSibling!.textContent).toMatch(/113,33/);
    expect(screen.getByText(/Equilíbrio/).nextSibling!.textContent).toMatch(/136,00/);
    expect(screen.getByText(/Margem mínima/).nextSibling!.textContent).toMatch(/185,45/);
    expect(screen.getByText(/Despesas pelo perfil de custos/)).toBeTruthy();
  });

  it('preço abaixo do custo mais imposto aparece como prejuízo', async () => {
    await openDrawer(row({ proposed: '100' }), []);
    expect(screen.getByText('Prejuízo')).toBeTruthy();
  });

  it('lista as entradas com a fotografia: documento, custo, preço, integridade e o que mudou desde então', async () => {
    await openDrawer(row(), [entry]);
    expect(await screen.findByText(/NF 123 · Fornecedor X \(SP\)/)).toBeTruthy();
    expect(screen.getByText(/preço alterado/)).toBeTruthy();
    expect(screen.getByText('Registro original, sem alterações.')).toBeTruthy();
    // a regra era margem 35% e hoje é 30%; o custo era 23,20 e hoje é 100
    expect(screen.getByText('regra de preço: margem 35% → margem 30%')).toBeTruthy();
    expect(screen.getByText(/custo desta compra/)).toBeTruthy();
  });

  it('registro adulterado aparece como alerta', async () => {
    await openDrawer(row(), [{ ...entry, intact: false }]);
    expect(await screen.findByText(/não confere com o original/)).toBeTruthy();
  });

  it('sem fotografias (notas antigas), cai no histórico de preço antigo', async () => {
    await openDrawer(row(), []);
    expect(await screen.findByText(/ainda não tem histórico de preço/)).toBeTruthy();
  });
});

describe('EntryTaxPayable', () => {
  it('monta a conta a pagar do ICMS de entrada com origem e ressalva', () => {
    expect(entryTaxPayableBody({ amount: 214.8, dueDate: '2026-11-10', invoiceNumber: 123, supplierName: 'Fornecedor X', estimated: false })).toMatchObject({
      supplierName: 'SEFAZ-PE',
      category: 'Tributos de entrada',
      description: 'ICMS de entrada (ST) · NF 123 · Fornecedor X',
      amount: 214.8,
      dueDate: '2026-11-10',
      installments: 1,
    });
    expect(entryTaxPayableBody({ amount: 20.08, dueDate: '2026-11-10', invoiceNumber: null, supplierName: 'Y', estimated: true }).notes).toMatch(/estimado/);
  });

  it('não cria sem vencimento; com vencimento, cria e confirma', async () => {
    api.postJson.mockResolvedValue({});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EntryTaxPayable amount="214.80" estimated={false} invoiceNumber={123} supplierName="Fornecedor X" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Criar conta a pagar/ }));
    expect((screen.getByLabelText('Valor') as HTMLInputElement).value).toBe('214,80');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(screen.getByText('Informe o vencimento')).toBeTruthy();
    expect(api.postJson).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Vencimento'), '2026-11-10');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(api.postJson).toHaveBeenCalledWith('/api/payables', expect.objectContaining({ amount: 214.8, dueDate: '2026-11-10', supplierName: 'SEFAZ-PE' }), expect.any(String));
    expect(await screen.findByText('Conta criada em Contas a pagar.')).toBeTruthy();
  });
});

describe('CostProfileNote', () => {
  it('diz a versão do perfil usado; fora do ar, avisa que valeu a regra; desligado, nada', () => {
    const { container, rerender } = render(<CostProfileNote status={{ status: 'OK', version: 4, channel: 'BALCAO', fixedPct: '15', variablePct: '4', financialPct: '0.5', extraUnitCost: '0', confidence: 'CONFIRMADO' }} />);
    expect(container.textContent).toMatch(/perfil de custos v4: estrutura 15% e despesas de venda 4,5%/);
    rerender(<CostProfileNote status={{ status: 'UNAVAILABLE' }} />);
    expect(container.textContent).toMatch(/usam as despesas da regra/);
    rerender(<CostProfileNote status={{ status: 'OFF' }} />);
    expect(container.textContent).toBe('');
  });
});
