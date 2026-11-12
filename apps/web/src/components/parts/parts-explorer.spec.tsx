// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PartDetail, PartHit, SearchResult } from '@/lib/part-search';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));

import { PartsExplorer } from './parts-explorer';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(cleanup);

const hit = (over: Partial<PartHit> = {}): PartHit => ({
  sku: 'cat-1',
  name: 'Bieleta Estabilizadora Dianteira',
  label: 'Bieleta Estabilizadora',
  partNumber: 'BE-123',
  brand: { key: 'FIAT', name: 'Fiat' },
  category: { id: 'c-susp', name: 'Suspensão' },
  isUniversalFit: false,
  relevanceScore: 10,
  ...over,
});

const result = (data: PartHit[], over: Partial<SearchResult> = {}): SearchResult => ({
  data,
  page: 1,
  limit: 24,
  total: data.length,
  totalPages: 1,
  truncated: false,
  facets: { brands: [{ key: 'FIAT', name: 'Fiat', count: data.length }], categories: [{ id: 'c-susp', name: 'Suspensão', count: data.length }] },
  ...over,
});

const detail = (over: Partial<PartDetail> = {}): PartDetail => ({
  sku: 'cat-1',
  name: 'Bieleta Estabilizadora Dianteira',
  partNumber: 'BE-123',
  oemCodes: ['51720-OEM'],
  barcodes: ['7891234567890'],
  titleSynonyms: [],
  brand: { key: 'FIAT', name: 'Fiat' },
  category: { id: 'c-susp', name: 'Suspensão', path: [{ id: 'c-root', name: 'Peças' }, { id: 'c-susp', name: 'Suspensão' }] },
  catalogAttributes: [{ name: 'Posição', value: 'Dianteira' }],
  isUniversalFit: false,
  crossPairs: ['NAKATA:N-1', 'COFAP:CF-9', 'FIAT:BE123'],
  applications: [
    { vehicleId: 'v1', make: 'Fiat', model: 'Strada', yearFrom: 2012, yearTo: 2020, engine: '1.4', vehicleName: 'Fiat Strada 1.4' },
    { vehicleId: 'v2', make: 'Volkswagen', model: 'Gol', yearFrom: 2010, yearTo: 2014, vehicleName: 'VW Gol' },
  ],
  active: true,
  ...over,
});

/** Roteia as chamadas da API do Fixer pela URL, como o servidor faria. */
function route(handlers: {
  search?: (url: string) => unknown;
  detail?: unknown;
  local?: unknown;
  history?: unknown;
  stock?: unknown[];
  workshop?: (url: string) => unknown;
  fiscal?: unknown;
  fits?: boolean;
  vehicles?: (url: string) => unknown;
  plate?: unknown;
  orders?: unknown[];
}) {
  api.getJson.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/catalog/vehicles/plate/')) return handlers.plate;
    if (url.startsWith('/api/catalog/vehicles')) return handlers.vehicles?.(url) ?? { makes: [] };
    if (url === '/api/service-orders') return handlers.orders ?? [];
    if (url.endsWith('/fiscal')) {
      if (handlers.fiscal instanceof Error) throw handlers.fiscal;
      return { fiscal: handlers.fiscal ?? null };
    }
    if (url.includes('/fits/')) return { compatible: handlers.fits ?? true };
    if (url.includes('/catalog/workshop/stock')) return { items: handlers.stock ?? [] };
    if (url.includes('/catalog/workshop/parts')) return handlers.workshop?.(url) ?? result([]);
    if (url.includes('/catalog/parts/search') || url.includes('/catalog/vehicle-parts')) return handlers.search?.(url) ?? result([]);
    if (url.includes('/catalog/parts/autocomplete')) return { data: [] };
    if (url.match(/\/catalog\/parts\/[^/?]+$/)) return handlers.detail ?? detail();
    if (url.includes('/api/parts?catalogSku')) return handlers.local ?? [];
    if (url.includes('/history')) return handlers.history;
    throw new Error(`rota inesperada: ${url}`);
  });
}

function setup(initial: Partial<import('@/lib/part-search').SearchState> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <PartsExplorer initial={{ q: '', page: 1, brands: [], categories: [], avail: 'all', ...initial }} />
    </QueryClientProvider>,
  );
  return { user };
}

describe('PartsExplorer', () => {
  it('sem texto abre no estoque da oficina, com o saldo de cada peça e sem buscar o estoque à parte', async () => {
    route({ workshop: () => result([hit({ workshop: { catalogSku: 'cat-1', partId: 'p1', sku: 'BE-123', stockQty: 3, sellPrice: 50 } })]) });
    setup();
    expect(await screen.findByRole('heading', { name: 'Estoque da oficina' })).toBeTruthy();
    expect(await screen.findByText('3 em estoque')).toBeTruthy();
    expect(api.getJson.mock.calls.some(([u]) => String(u).includes('/catalog/workshop/stock'))).toBe(false);
  });

  it('oficina ainda sem estoque: boas-vindas com o convite para escolher o veículo', async () => {
    route({});
    setup();
    expect(await screen.findByText(/o catálogo inteiro já está disponível/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /escolher veículo/i }).length).toBeGreaterThan(0);
  });

  it('busca vinda da URL lista as peças com contagem e filtros', async () => {
    route({ search: () => result([hit(), hit({ sku: 'cat-2', name: 'Bieleta Traseira', partNumber: 'BT-9' })]) });
    setup({ q: 'bieleta' });
    expect(await screen.findByRole('button', { name: /abrir bieleta estabilizadora dianteira/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /abrir bieleta traseira/i })).toBeTruthy();
    expect(screen.getByText('2', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: /filtros/i })).toBeTruthy();
  });

  it('marcar uma marca refaz a busca com brandKey e mostra o chip removível', async () => {
    route({ search: () => result([hit()]) });
    const { user } = setup({ q: 'bieleta' });
    await screen.findByRole('button', { name: /abrir bieleta/i });
    const aside = screen.getByRole('complementary', { name: /filtros/i });
    await user.click(within(aside).getByRole('checkbox', { name: /fiat/i }));
    await waitFor(() => expect(api.getJson.mock.calls.some(([u]) => String(u).includes('brandKey=FIAT'))).toBe(true));
    expect(screen.getByRole('button', { name: /fiat.*remover filtro/i })).toBeTruthy();
  });

  it('sem resultado oferece limpar filtros', async () => {
    route({ search: () => result([], { facets: { brands: [], categories: [] } }) });
    setup({ q: 'zzzz', brands: ['FIAT'] });
    expect(await screen.findByText(/nada encontrado para “zzzz”/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /limpar filtros/i })).toBeTruthy();
  });

  it('erro da plataforma mostra a mensagem e permite tentar de novo', async () => {
    api.getJson.mockRejectedValue(new Error('Catálogo de peças indisponível.'));
    setup({ q: 'bieleta' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Catálogo de peças indisponível.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeTruthy();
  });

  it('abrir a peça mostra a ficha: equivalentes agrupados, sem o próprio código, e a compatibilidade filtrável', async () => {
    route({ search: () => result([hit()]) });
    const { user } = setup({ q: 'bieleta' });
    await user.click(await screen.findByRole('button', { name: /abrir bieleta/i }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('7891234567890')).toBeTruthy();

    await user.click(within(dialog).getByRole('tab', { name: /equivalentes/i }));
    expect(await within(dialog).findByText('N-1')).toBeTruthy();
    expect(within(dialog).getByText('CF-9')).toBeTruthy();
    expect(within(dialog).queryByText('BE123')).toBeNull();

    await user.click(within(dialog).getByRole('tab', { name: /veículos/i }));
    await user.type(within(dialog).getByPlaceholderText(/filtrar por marca/i), 'gol');
    expect(within(dialog).getByText(/1 de 2/)).toBeTruthy();
  });

  it('clicar num equivalente busca por aquele código e fecha a ficha', async () => {
    route({ search: () => result([hit()]) });
    const { user } = setup({ q: 'bieleta' });
    await user.click(await screen.findByRole('button', { name: /abrir bieleta/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('tab', { name: /equivalentes/i }));
    await user.click(await within(dialog).findByRole('button', { name: 'N-1' }));
    await waitFor(() => expect(api.getJson.mock.calls.some(([u]) => String(u).includes('q=N-1'))).toBe(true));
    expect((screen.getByRole('combobox', { name: /buscar peças/i }) as HTMLInputElement).value).toBe('N-1');
  });

  it('aba Oficina: peça que a oficina nunca teve é só "sem estoque" (nada de cadastrar); com estoque mostra compras e vendas', async () => {
    route({ search: () => result([hit()]), local: [] });
    const { user } = setup({ q: 'bieleta', sku: 'cat-1' });
    let dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Sem estoque na oficina')).toBeTruthy();
    await user.click(await within(dialog).findByRole('tab', { name: /oficina/i }));
    expect(await within(dialog).findByText(/entra no estoque pela nota de compra/i)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /cadastrar/i })).toBeNull();
    cleanup();

    const part = { id: 'p1', sku: 'BE-123', name: 'Bieleta', costPrice: '40', sellPrice: '89.9', stockQty: '4', catalogSku: 'cat-1', avgCost: '41' };
    route({
      search: () => result([hit()]),
      local: [part],
      history: {
        part,
        totals: { purchases: 1, boughtQty: '10', sales: 1, soldQty: '2' },
        purchases: [{ id: 'm1', createdAt: '2026-09-01T10:00:00Z', quantity: '10', unitCost: '40', note: null, purchaseInvoiceItem: { invoice: { id: 'i1', number: 321, issuerName: 'Distribuidora Alfa', issuedAt: null } } }],
        sales: [{ id: 's1', createdAt: '2026-10-02T10:00:00Z', quantity: '2', unitPrice: '89.9', unitCost: '40', serviceOrder: { id: 'o1', number: 77, status: 'DELIVERED', customer: { name: 'João' }, vehicle: { plate: 'ABC1D23', brand: 'Fiat', model: 'Strada' } } }],
        prices: [],
      },
    });
    const { user: user2 } = setup({ q: 'bieleta', sku: 'cat-1' });
    dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('4 em estoque')).toBeTruthy();
    await user2.click(await within(dialog).findByRole('button', { name: 'Histórico' }));
    expect(await within(dialog).findByText('Distribuidora Alfa')).toBeTruthy();
    expect(within(dialog).getByText(/NF 321/)).toBeTruthy();
    expect(within(dialog).getByText(/OS 77 · João/)).toBeTruthy();
    expect(within(dialog).getByText(/ABC1D23/)).toBeTruthy();
  });

  it('marcar duas peças libera o comparador', async () => {
    route({ search: () => result([hit(), hit({ sku: 'cat-2', name: 'Bieleta Traseira', partNumber: 'BT-9' })]), detail: detail() });
    const { user } = setup({ q: 'bieleta' });
    await screen.findByRole('button', { name: /abrir bieleta estabilizadora/i });
    await user.click(screen.getByRole('button', { name: /^comparar bieleta estabilizadora/i }));
    expect((screen.getByRole('button', { name: /^comparar$/i }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /^comparar bieleta traseira/i }));
    await user.click(screen.getByRole('button', { name: /^comparar$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Comparar peças')).toBeTruthy();
    expect(await within(dialog).findByText('Posição')).toBeTruthy();
  });

  it('a tecla / leva o foco à busca', async () => {
    route({});
    const { user } = setup();
    await user.keyboard('/');
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: /buscar peças/i }));
  });

  it('mostra o saldo e o preço da oficina na linha; a peça que a oficina nunca teve aparece sem estoque, sem botão de cadastro', async () => {
    route({
      search: () => result([hit(), hit({ sku: 'cat-2', name: 'Bieleta Traseira', partNumber: 'BT-9' })]),
      stock: [{ catalogSku: 'cat-1', partId: 'p1', sku: 'BE-123', stockQty: 4, sellPrice: 89.9 }],
    });
    setup({ q: 'bieleta' });
    expect(await screen.findByText('4 em estoque')).toBeTruthy();
    expect(screen.getByText(/89,90/)).toBeTruthy();
    expect(screen.getByText('Sem estoque')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cadastrar/i })).toBeNull();
  });

  it('"Na oficina" e "Com saldo" são filtros da mesma busca: o texto continua, a lista vem da oficina e marca/categoria saem', async () => {
    route({ search: () => result([hit()]), workshop: () => result([hit({ workshop: { catalogSku: 'cat-1', partId: 'p1', sku: 'BE-123', stockQty: 0, sellPrice: 50 } })]) });
    const { user } = setup({ q: 'bieleta', brands: ['FIAT'] });
    await screen.findByRole('button', { name: /fiat.*remover filtro/i });
    await user.click(screen.getByRole('radio', { name: 'Na oficina' }));
    expect(await screen.findByText('Sem estoque')).toBeTruthy();
    expect(api.getJson.mock.calls.some(([u]) => String(u).includes('/catalog/workshop/parts') && String(u).includes('q=bieleta'))).toBe(true);
    expect(screen.queryByRole('button', { name: /fiat.*remover filtro/i })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Com saldo' }));
    await waitFor(() => expect(api.getJson.mock.calls.some(([u]) => String(u).includes('/catalog/workshop/parts') && String(u).includes('inStock=true'))).toBe(true));
  });

  it('nada na oficina para o texto: oferece buscar no catálogo inteiro', async () => {
    route({ search: () => result([hit()]) });
    const { user } = setup({ q: 'bieleta', avail: 'mine' });
    expect(await screen.findByText(/nada na oficina para “bieleta”/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /buscar no catálogo inteiro/i }));
    expect(await screen.findByRole('button', { name: /abrir bieleta/i })).toBeTruthy();
  });

  it('veículo pela cascata: montadora → modelo → ano → versão; a lista passa a ser a do veículo e a disponibilidade trava', async () => {
    const strada = { vehicleId: 'v-strada', make: 'Fiat', model: 'Strada', name: 'Strada Working 1.4', engine: '1.4', yearFrom: 2014, yearTo: 2020, partCount: 321 };
    route({
      workshop: () => result([hit()]),
      search: () => result([hit()]),
      vehicles: (url) => {
        const p = new URL(url, 'http://x').searchParams;
        const makes = [
          { name: 'Fiat', vehicles: 10, parts: 900 },
          { name: 'Volkswagen', vehicles: 8, parts: 700 },
        ];
        if (!p.get('make')) return { makes };
        if (!p.get('model')) return { makes, models: [{ name: 'Strada', vehicles: 3, parts: 400 }] };
        return { makes, models: [], years: [2016, 2015], vehicles: [strada] };
      },
    });
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /escolher veículo/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /^fiat/i }));
    await user.click(await within(dialog).findByRole('button', { name: /^strada/i }));
    await user.click(await within(dialog).findByRole('button', { name: '2016' }));
    await waitFor(() => expect(api.getJson.mock.calls.some(([u]) => String(u).includes('year=2016'))).toBe(true));
    await user.click(await within(dialog).findByRole('button', { name: /fiat strada working 1\.4/i }));

    expect(await screen.findByText('Fiat Strada Working 1.4 · 2016')).toBeTruthy();
    await waitFor(() => expect(api.getJson.mock.calls.some(([u]) => String(u).includes('/catalog/vehicle-parts?') && String(u).includes('vehicleId=v-strada'))).toBe(true));
    expect((screen.getByRole('radio', { name: 'Na oficina' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: /remover o veículo/i }));
    expect(await screen.findByRole('heading', { name: 'Estoque da oficina' })).toBeTruthy();
  });

  it('veículo pela placa de uma OS aberta: mostra o que a placa diz e as versões do catálogo', async () => {
    const gol = { vehicleId: 'v-gol', make: 'Volkswagen', model: 'Gol', name: 'VW Gol 1.6 MSI', engine: '1.6', yearFrom: 2013, yearTo: 2016, partCount: 50 };
    route({
      workshop: () => result([hit()]),
      search: () => result([hit()]),
      orders: [{ id: 'o1', number: 42, status: 'IN_PROGRESS', createdAt: '', customer: { id: 'c', name: 'Ana' }, vehicle: { id: 'x', plate: 'ABC1D23', brand: 'VW', model: 'Gol' } }],
      plate: { plate: 'ABC1D23', vehicle: { label: 'VW/GOL 1.6 MSI', make: 'vw', model: 'gol', engine: '1.6', year: 2015 }, candidates: [gol] },
    });
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /escolher veículo/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /ABC1D23/ }));
    expect(await within(dialog).findByText('VW/GOL 1.6 MSI')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /vw gol 1\.6 msi/i }));
    expect(await screen.findByText('VW Gol 1.6 MSI · 2015')).toBeTruthy();
  });

  it('placa inválida não consulta nada e explica o formato', async () => {
    route({ workshop: () => result([hit()]) });
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /escolher veículo/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: /placa/i }));
    await user.type(within(dialog).getByPlaceholderText('ABC1D23'), 'AB12');
    await user.click(within(dialog).getByRole('button', { name: /^buscar$/i }));
    expect(within(dialog).getByText(/placa inválida/i)).toBeTruthy();
    expect(api.getJson.mock.calls.some(([u]) => String(u).includes('/vehicles/plate/'))).toBe(false);
  });

  it('aba Fiscal mostra NCM formatado, a origem do dado e o aceite do contador', async () => {
    route({
      search: () => result([hit()]),
      fiscal: {
        sku: 'cat-1',
        item: { ncm: '87083010', cest: null, origin: '0', exTipi: null, attributes: {} },
        unit: 'UN',
        fields: { ncm: { from: 'OVERRIDE', source: 'MANUAL', confidence: 'CONFIRMADO' } },
        fiscalStatus: 'INCOMPLETO',
        missing: ['cest'],
        review: { accepted: true, reviewedAt: '2026-09-01T10:00:00Z', reviewedBy: 'c', stale: false },
      },
    });
    const { user } = setup({ q: 'bieleta', sku: 'cat-1' });
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('tab', { name: /fiscal/i }));
    expect(await within(dialog).findByText('8708.30.10')).toBeTruthy();
    expect(within(dialog).getByText(/ajuste da oficina · confirmado/i)).toBeTruthy();
    expect(within(dialog).getByText('Incompleto')).toBeTruthy();
    expect(within(dialog).getByText(/falta: cest/i)).toBeTruthy();
    expect(within(dialog).getByText(/aceito pelo contador em/i)).toBeTruthy();
  });

  it('aba Fiscal sem permissão mostra a mensagem da API e permite tentar de novo', async () => {
    route({ search: () => result([hit()]), fiscal: new Error('Sem permissão para esta ação.') });
    const { user } = setup({ q: 'bieleta', sku: 'cat-1' });
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('tab', { name: /fiscal/i }));
    expect(await within(dialog).findByText('Sem permissão para esta ação.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /tentar de novo/i })).toBeTruthy();
  });

  it('com um veículo escolhido, a ficha diz se a peça serve nele', async () => {
    route({ search: () => result([hit()]), fits: false });
    setup({ q: 'bieleta', sku: 'cat-1', vehicle: { id: 'v1', label: 'Fiat Strada 1.4' } });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/não serve no fiat strada 1\.4/i)).toBeTruthy();
  });
});
