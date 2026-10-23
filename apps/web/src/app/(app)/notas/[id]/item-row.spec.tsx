// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceSuggestion } from '@/lib/catalog';
import type { InvoiceItem } from '@/lib/invoices';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), putJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { ItemRow } from './item-row';

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
  api.putJson.mockResolvedValue({});
  api.postJson.mockResolvedValue({});
});
afterEach(cleanup);

const item = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({
  id: 'it1',
  itemNumber: 1,
  supplierCode: 'PAST-001',
  ean: '7891234567895',
  description: 'PASTILHA DE FREIO DIANTEIRA',
  ncm: '87083090',
  cest: '0107500',
  cfop: '5102',
  unit: 'CX',
  quantity: '2',
  unitPrice: '41.9',
  totalPrice: '83.8',
  resolution: 'UNRESOLVED',
  unitFactor: '1',
  partId: null,
  part: null,
  ...over,
});
const linkedItem = (catalogSku: string | null) =>
  item({ resolution: 'MANUAL', partId: 'p1', part: { id: 'p1', sku: 'PAST-1', name: 'Pastilha da oficina', stockQty: '3', catalogSku } });
const suggestion: InvoiceSuggestion = { itemId: 'it1', partId: 'p9', partSku: 'BE-9', partName: 'Pastilha já no estoque', catalogSku: 'cat-9' };
const hit = { sku: 'cat-1', name: 'Pastilha do catálogo', partNumber: 'PC-77', brand: { key: 'FRAS', name: 'Fras-le' } };

function setup(over: { item?: InvoiceItem; editable?: boolean; suggestion?: InvoiceSuggestion } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ul>
        <ItemRow invoiceId="inv1" item={over.item ?? item()} editable={over.editable ?? true} suggestion={over.suggestion} />
      </ul>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
const click = (user: ReturnType<typeof userEvent.setup>, name: RegExp) => user.click(screen.getByRole('button', { name }));

/** Escolhe a peça do catálogo no primeiro seletor aberto da tela. */
async function pickCatalogPart(user: ReturnType<typeof userEvent.setup>) {
  api.getJson.mockResolvedValue({ data: [hit] });
  await user.click(screen.getByRole('combobox', { name: /peça do catálogo/i }));
  await user.click(await screen.findByText('Pastilha do catálogo'));
}

describe('ItemRow: sugestão do catálogo', () => {
  it('item sem peça com sugestão: mostra a peça da oficina já ligada ao catálogo pelo código de barras', () => {
    setup({ suggestion });
    const box = screen.getByRole('region', { name: /sugestão/i });
    expect(box.textContent).toContain('Pastilha já no estoque');
    expect(box.textContent).toContain('BE-9');
    expect(box.textContent).toMatch(/código de barras/i);
  });

  it('sem sugestão, ou com a nota que não pode mais ser editada, não aparece', () => {
    setup();
    expect(screen.queryByRole('region', { name: /sugestão/i })).toBeNull();
    cleanup();
    setup({ suggestion, editable: false });
    expect(screen.queryByRole('region', { name: /sugestão/i })).toBeNull();
  });

  it('item que já tem peça não mostra sugestão', () => {
    setup({ item: linkedItem(null), suggestion });
    expect(screen.queryByRole('region', { name: /sugestão/i })).toBeNull();
  });

  it('"Usar esta peça" abre o vínculo já com a peça escolhida (a pessoa ainda confere as unidades por embalagem) e salva como vínculo manual', async () => {
    const user = setup({ suggestion });
    await click(user, /usar esta peça/i);
    expect(screen.getByRole('combobox', { name: /peça/i }).textContent).toContain('BE-9 · Pastilha já no estoque');
    await click(user, /salvar vínculo/i);
    await waitFor(() => expect(api.putJson).toHaveBeenCalledWith('/api/invoices/inv1/items/1', { action: 'link', partId: 'p9', unitFactor: 1, saveMapping: true }, expect.any(String)));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe('ItemRow: peça vinculada e o catálogo', () => {
  it('mostra se a peça já está no catálogo ou é só da oficina', () => {
    setup({ item: linkedItem('cat-1') });
    expect(screen.getByText('No catálogo')).toBeTruthy();
    cleanup();
    setup({ item: linkedItem(null) });
    expect(screen.getByText('Só da oficina')).toBeTruthy();
  });

  it('peça só da oficina oferece "Vincular ao catálogo"; peça já no catálogo, não', () => {
    setup({ item: linkedItem(null) });
    expect(screen.getByRole('button', { name: /vincular ao catálogo/i })).toBeTruthy();
    cleanup();
    setup({ item: linkedItem('cat-1') });
    expect(screen.queryByRole('button', { name: /vincular ao catálogo/i })).toBeNull();
  });

  it('nota que não pode mais ser editada não oferece o vínculo', () => {
    setup({ item: linkedItem(null), editable: false });
    expect(screen.queryByRole('button', { name: /vincular ao catálogo/i })).toBeNull();
  });

  it('escolhe a peça do catálogo e vincula a peça da oficina a ela', async () => {
    const user = setup({ item: linkedItem(null) });
    await click(user, /vincular ao catálogo/i);
    await pickCatalogPart(user);
    await click(user, /^vincular$/i);
    await waitFor(() => expect(api.putJson).toHaveBeenCalledWith('/api/parts/p1/catalog-link', { catalogSku: 'cat-1' }, expect.any(String)));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('sem escolher a peça do catálogo, avisa e não chama a API', async () => {
    const user = setup({ item: linkedItem(null) });
    await click(user, /vincular ao catálogo/i);
    await click(user, /^vincular$/i);
    expect((await screen.findByRole('alert')).textContent).toMatch(/escolha a peça do catálogo/i);
    expect(api.putJson).not.toHaveBeenCalled();
  });

  it('a API recusa (ex.: já está no estoque, sem permissão): a mensagem dela aparece e o formulário continua aberto', async () => {
    api.putJson.mockRejectedValue(new Error('Esta peça do catálogo já está no estoque da oficina'));
    const user = setup({ item: linkedItem(null) });
    await click(user, /vincular ao catálogo/i);
    await pickCatalogPart(user);
    await click(user, /^vincular$/i);
    expect((await screen.findByRole('alert')).textContent).toContain('já está no estoque da oficina');
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^vincular$/i })).toBeTruthy();
  });
});

describe('ItemRow: cadastrar peça a partir do catálogo', () => {
  const openCreate = async (user: ReturnType<typeof userEvent.setup>) => click(user, /cadastrar peça/i);
  const fillPrice = async (user: ReturnType<typeof userEvent.setup>, v = '70') => user.type(screen.getByLabelText(/preço de venda/i), v);

  it('o formulário oferece a busca no catálogo (opcional) e explica o que vem de onde', async () => {
    const user = setup();
    await openCreate(user);
    expect(screen.getByRole('combobox', { name: /peça do catálogo/i })).toBeTruthy();
    expect(screen.getByText(/nome e o sku vêm do catálogo/i)).toBeTruthy();
  });

  it('escolher a peça do catálogo preenche o SKU e o nome com os dela', async () => {
    const user = setup();
    await openCreate(user);
    await pickCatalogPart(user);
    expect((screen.getByLabelText(/^sku/i) as HTMLInputElement).value).toBe('PC-77');
    expect((screen.getByLabelText(/^nome/i) as HTMLInputElement).value).toBe('Pastilha do catálogo');
  });

  it('com peça do catálogo, o cadastro leva o catalogSku (e só ele: nome e GTIN do catálogo nunca vão no corpo além do que a pessoa vê)', async () => {
    const user = setup();
    await openCreate(user);
    await pickCatalogPart(user);
    await fillPrice(user);
    await click(user, /cadastrar e vincular/i);
    await waitFor(() =>
      expect(api.postJson).toHaveBeenCalledWith(
        '/api/invoices/inv1/items/1/create-part',
        { sku: 'PC-77', name: 'Pastilha do catálogo', sellPrice: 70, unitFactor: 1, saveMapping: true, catalogSku: 'cat-1' },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('sem escolher no catálogo, o cadastro é o de sempre (sem catalogSku)', async () => {
    const user = setup();
    await openCreate(user);
    await fillPrice(user);
    await click(user, /cadastrar e vincular/i);
    await waitFor(() => expect(api.postJson).toHaveBeenCalled());
    const body = api.postJson.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ sku: 'PAST-001', name: 'PASTILHA DE FREIO DIANTEIRA', sellPrice: 70, unitFactor: 1, saveMapping: true });
    expect(body).not.toHaveProperty('catalogSku');
  });

  it('a pessoa pode ajustar o SKU e o nome depois de escolher a peça do catálogo', async () => {
    const user = setup();
    await openCreate(user);
    await pickCatalogPart(user);
    await user.clear(screen.getByLabelText(/^sku/i));
    await user.type(screen.getByLabelText(/^sku/i), 'MEU-SKU');
    await fillPrice(user);
    await click(user, /cadastrar e vincular/i);
    await waitFor(() => expect(api.postJson).toHaveBeenCalled());
    expect(api.postJson.mock.calls[0]![1]).toMatchObject({ sku: 'MEU-SKU', catalogSku: 'cat-1' });
  });

  it('a API recusa (ex.: peça do catálogo já no estoque): a mensagem aparece dentro do formulário', async () => {
    api.postJson.mockRejectedValue(new Error('Esta peça do catálogo já está no estoque da oficina'));
    const user = setup();
    await openCreate(user);
    await pickCatalogPart(user);
    await fillPrice(user);
    await click(user, /cadastrar e vincular/i);
    const form = screen.getByRole('button', { name: /cadastrar e vincular/i }).closest('form')!;
    expect((await within(form).findByRole('alert')).textContent).toContain('já está no estoque da oficina');
  });
});
