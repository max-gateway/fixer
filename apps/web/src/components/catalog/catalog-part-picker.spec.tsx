// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogHit } from '@/lib/catalog';

const api = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));

import { CatalogPartPicker } from './catalog-part-picker';

beforeAll(() => {
  // O cmdk e o Radix usam APIs que o jsdom não traz.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const hit = (over: Partial<CatalogHit> = {}): CatalogHit => ({ sku: 'cat-1', name: 'Bieleta Estabilizadora', partNumber: 'BE-123', brand: { key: 'FIAT', name: 'Fiat' }, ...over });

function setup(props: { value?: CatalogHit | null; initialQuery?: string } = {}) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <CatalogPartPicker id="p" value={props.value ?? null} onChange={onChange} initialQuery={props.initialQuery} />
    </QueryClientProvider>,
  );
  return { onChange, user: userEvent.setup(), ...utils };
}
const open = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /buscar no catálogo|BE-123/i }));

describe('CatalogPartPicker', () => {
  it('sem peça escolhida mostra o convite; com peça mostra número e nome', () => {
    setup();
    expect(screen.getByRole('button', { name: /buscar no catálogo|BE-123/i }).textContent).toContain('Buscar no catálogo');
    cleanup();
    setup({ value: hit() });
    expect(screen.getByRole('button', { name: /buscar no catálogo|BE-123/i }).textContent).toContain('BE-123 · Bieleta Estabilizadora');
  });

  it('abrir sem texto suficiente não busca e pede pelo menos 2 letras', async () => {
    const { user } = setup();
    await open(user);
    expect(await screen.findByText(/pelo menos 2 letras/i)).toBeTruthy();
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('digitar busca no catálogo (texto escapado, no máximo 10) e lista nome, número e marca', async () => {
    api.getJson.mockResolvedValue({ data: [hit(), hit({ sku: 'cat-2', name: 'Bieleta Dianteira', partNumber: 'BD-9', brand: undefined })] });
    const { user } = setup();
    await open(user);
    await user.type(screen.getByPlaceholderText(/nome ou código/i), 'bieleta & cia');
    const first = await screen.findByRole('option', { name: /Bieleta Estabilizadora/ });
    expect(first.textContent).toContain('BE-123 · Fiat');
    expect(screen.getByRole('option', { name: /Bieleta Dianteira/ }).textContent).toContain('BD-9');
    expect(api.getJson).toHaveBeenLastCalledWith('/api/catalog/parts/search?q=bieleta%20%26%20cia&limit=10', expect.any(String));
  });

  it('começa a busca com o texto inicial (a descrição do item da nota)', async () => {
    api.getJson.mockResolvedValue({ data: [] });
    const { user } = setup({ initialQuery: 'PASTILHA DE FREIO' });
    await open(user);
    await waitFor(() => expect(api.getJson).toHaveBeenCalledWith('/api/catalog/parts/search?q=PASTILHA%20DE%20FREIO&limit=10', expect.any(String)));
  });

  it('escolher uma peça devolve a peça inteira e fecha a lista', async () => {
    api.getJson.mockResolvedValue({ data: [hit()] });
    const { user, onChange } = setup({ initialQuery: 'biel' });
    await open(user);
    await user.click(await screen.findByRole('option', { name: /Bieleta Estabilizadora/ }));
    expect(onChange).toHaveBeenCalledWith(hit());
    await waitFor(() => expect(screen.queryByPlaceholderText(/nome ou código/i)).toBeNull());
  });

  it('escolher de novo a peça já marcada a limpa', async () => {
    api.getJson.mockResolvedValue({ data: [hit()] });
    const { user, onChange } = setup({ value: hit(), initialQuery: 'biel' });
    await open(user);
    await user.click(await screen.findByRole('option', { name: /Bieleta Estabilizadora/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('mostra a foto da peça na lista e cai no ícone quando não há imagem', async () => {
    api.getJson.mockResolvedValue({ data: [hit({ imageUrl: 'https://img.test/be.jpg' }), hit({ sku: 'cat-2', name: 'Bieleta Dianteira', partNumber: 'BD-9' })] });
    const { user } = setup({ initialQuery: 'biel' });
    await open(user);
    const rows = await screen.findAllByRole('option');
    expect(rows[0]!.querySelector('img')?.getAttribute('src')).toBe('https://img.test/be.jpg');
    expect(rows[1]!.querySelector('img')).toBeNull();
  });

  it('o botão de limpar tira a peça escolhida sem abrir a busca', async () => {
    const { user, onChange } = setup({ value: hit() });
    await user.click(screen.getByRole('button', { name: /limpar peça do catálogo/i }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByPlaceholderText(/nome ou código/i)).toBeNull();
  });

  it('Enter escolhe a peça em foco (a primeira, sem tocar no mouse)', async () => {
    api.getJson.mockResolvedValue({ data: [hit(), hit({ sku: 'cat-2', name: 'Bieleta Dianteira', partNumber: 'BD-9' })] });
    const { user, onChange } = setup({ initialQuery: 'biel' });
    await open(user);
    await screen.findByRole('option', { name: /Bieleta Estabilizadora/ });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sku: 'cat-2' }));
  });

  it('sem resultado: avisa que o catálogo não tem a peça', async () => {
    api.getJson.mockResolvedValue({ data: [] });
    const { user } = setup({ initialQuery: 'xyzxyz' });
    await open(user);
    expect(await screen.findByText(/nenhuma peça encontrada no catálogo/i)).toBeTruthy();
  });

  it('catálogo indisponível: mostra a mensagem que a API traduziu, como alerta', async () => {
    api.getJson.mockRejectedValue(new Error('Catálogo de peças indisponível no momento. Tente novamente em instantes.'));
    const { user } = setup({ initialQuery: 'biel' });
    await open(user);
    expect((await screen.findByRole('alert')).textContent).toContain('Catálogo de peças indisponível no momento');
  });
});
