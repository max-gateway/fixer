// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkReport } from '@/lib/catalog';

const api = vi.hoisted(() => ({ postJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));

import { CatalogLinkCard } from './catalog-link-card';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const report = (summary: Partial<LinkReport['summary']> = {}, over: Partial<LinkReport> = {}): LinkReport => ({
  scanned: 10,
  truncated: false,
  summary: { linkable: 0, ambiguousCatalog: 0, ambiguousLocal: 0, conflict: 0, noMatch: 0, linked: 0, ...summary },
  ...over,
});

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <CatalogLinkCard />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
const button = (name: RegExp) => screen.getByRole('button', { name });

describe('CatalogLinkCard (vínculo em lote pelo código de barras)', () => {
  it('abre só com o convite para verificar: nada é consultado nem gravado sozinho', () => {
    setup();
    expect(button(/verificar peças/i)).toBeTruthy();
    expect(api.postJson).not.toHaveBeenCalled();
  });

  it('verificar SIMULA (corpo vazio, sem apply) e mostra o que foi achado, em palavras', async () => {
    api.postJson.mockResolvedValue(report({ linkable: 3, ambiguousCatalog: 1, ambiguousLocal: 2, conflict: 1, noMatch: 3 }));
    const user = setup();
    await user.click(button(/verificar peças/i));
    expect(await screen.findByText(/10 peças verificadas/i)).toBeTruthy();
    expect(api.postJson).toHaveBeenCalledWith('/api/parts/catalog-links/by-barcode', {}, expect.any(String));
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/3 podem ser vinculadas/i);
    expect(text).toMatch(/1 tem mais de uma peça no catálogo com o mesmo código/i);
    expect(text).toMatch(/2 têm código de barras repetido no seu estoque/i);
    expect(text).toMatch(/1 já é de outra peça do seu estoque/i);
    expect(text).toMatch(/3 sem correspondência no catálogo/i);
  });

  it('nada vinculável: avisa e não oferece gravar', async () => {
    api.postJson.mockResolvedValue(report({ noMatch: 4 }));
    const user = setup();
    await user.click(button(/verificar peças/i));
    expect(await screen.findByText(/nenhuma peça para vincular agora/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^vincular/i })).toBeNull();
  });

  it('com peças vinculáveis, gravar pede confirmação e só então manda apply:true', async () => {
    api.postJson.mockResolvedValueOnce(report({ linkable: 3 })).mockResolvedValueOnce(report({ linkable: 3, linked: 3 }));
    const user = setup();
    await user.click(button(/verificar peças/i));
    await user.click(await screen.findByRole('button', { name: /vincular as 3 peças/i }));
    // Ainda não gravou: só perguntou.
    expect(screen.getByText(/vincular 3 peças ao catálogo pelo código de barras\?/i)).toBeTruthy();
    expect(api.postJson).toHaveBeenCalledTimes(1);
    await user.click(button(/^confirmar$/i));
    await waitFor(() => expect(api.postJson).toHaveBeenLastCalledWith('/api/parts/catalog-links/by-barcode', { apply: true }, expect.any(String)));
    expect(await screen.findByText(/3 peças vinculadas/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /vincular as/i })).toBeNull();
  });

  it('cancelar a confirmação não grava nada e volta ao resultado', async () => {
    api.postJson.mockResolvedValue(report({ linkable: 1 }));
    const user = setup();
    await user.click(button(/verificar peças/i));
    await user.click(await screen.findByRole('button', { name: /vincular a peça/i }));
    await user.click(button(/^cancelar$/i));
    expect(api.postJson).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /vincular a peça/i })).toBeTruthy();
  });

  it('usa o singular com uma só peça', async () => {
    api.postJson.mockResolvedValue(report({ linkable: 1 }, { scanned: 1 }));
    const user = setup();
    await user.click(button(/verificar peças/i));
    expect(await screen.findByText(/1 peça verificada/i)).toBeTruthy();
    expect(document.body.textContent).toMatch(/1 pode ser vinculada/i);
  });

  it('havia mais peças que o limite da rodada: manda rodar de novo', async () => {
    api.postJson.mockResolvedValue(report({ noMatch: 2 }, { truncated: true, scanned: 2000 }));
    const user = setup();
    await user.click(button(/verificar peças/i));
    expect(await screen.findByText(/há mais peças para verificar/i)).toBeTruthy();
  });

  it('a verificação falha (sem permissão, catálogo fora do ar): mostra a mensagem da API como alerta e deixa tentar de novo', async () => {
    api.postJson.mockRejectedValue(new Error('Você não tem permissão para esta operação.'));
    const user = setup();
    await user.click(button(/verificar peças/i));
    expect((await screen.findByRole('alert')).textContent).toContain('Você não tem permissão');
    expect(button(/verificar peças/i)).toBeTruthy();
  });

  it('a gravação falha: a mensagem aparece e o resultado da verificação continua à vista', async () => {
    api.postJson.mockResolvedValueOnce(report({ linkable: 2 })).mockRejectedValueOnce(new Error('Catálogo de peças indisponível no momento.'));
    const user = setup();
    await user.click(button(/verificar peças/i));
    await user.click(await screen.findByRole('button', { name: /vincular as 2 peças/i }));
    await user.click(button(/^confirmar$/i));
    expect((await screen.findByRole('alert')).textContent).toContain('indisponível');
    expect(screen.getByText(/2 podem ser vinculadas/i)).toBeTruthy();
  });

  it('verificar de novo depois de gravar recomeça do zero (a lista mudou)', async () => {
    api.postJson.mockResolvedValueOnce(report({ linkable: 1 })).mockResolvedValueOnce(report({ linkable: 1, linked: 1 })).mockResolvedValueOnce(report({ noMatch: 5 }));
    const user = setup();
    await user.click(button(/verificar peças/i));
    await user.click(await screen.findByRole('button', { name: /vincular a peça/i }));
    await user.click(button(/^confirmar$/i));
    await screen.findByText(/1 peça vinculada/i);
    await user.click(button(/verificar de novo/i));
    expect(await screen.findByText(/nenhuma peça para vincular agora/i)).toBeTruthy();
    expect(api.postJson).toHaveBeenLastCalledWith('/api/parts/catalog-links/by-barcode', {}, expect.any(String));
  });
});
