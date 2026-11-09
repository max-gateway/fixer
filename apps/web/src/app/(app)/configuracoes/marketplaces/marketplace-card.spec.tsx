// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceOverview } from '@/lib/marketplace';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), deleteJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.params, usePathname: () => '/configuracoes/marketplaces', useRouter: () => ({ replace: nav.replace }) }));

import { MarketplaceCard } from './marketplace-card';

const ACC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const overview = (over: Partial<MarketplaceOverview> = {}): MarketplaceOverview => ({ enabled: true, provider: 'mercadolivre', canConnect: true, redirectUri: 'https://mk.test/cb', accounts: [], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  nav.params = new URLSearchParams();
});
afterEach(cleanup);

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MarketplaceCard />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('MarketplaceCard', () => {
  it('ambiente sem a integração: avisa e não oferece conectar', async () => {
    api.getJson.mockResolvedValue(overview({ enabled: false, canConnect: false }));
    setup();
    expect(await screen.findByText(/ainda não está disponível/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /conectar/i })).toBeNull();
  });

  it('primeira vez: o assistente explica a criação do app, mostra o endereço de retorno e só então pede os dados', async () => {
    api.getJson.mockResolvedValue(overview({ canConnect: false, redirectUri: 'https://mk.test/v1/oauth/mercadolivre/callback' }));
    const user = setup();
    await user.click(await screen.findByRole('button', { name: /conectar mercado livre/i }));
    expect(await screen.findByText(/criar nova aplicação/i)).toBeTruthy();
    expect(screen.getByText('https://mk.test/v1/oauth/mercadolivre/callback')).toBeTruthy();
    expect(screen.getByRole('link', { name: /abrir o painel do mercado livre/i }).getAttribute('href')).toMatch(/developers\.mercadolivre/);
    expect(screen.queryByLabelText(/chave secreta/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /já criei, continuar/i }));
    expect(screen.getByLabelText(/id do aplicativo/i)).toBeTruthy();
    expect(screen.getByLabelText(/chave secreta/i)).toBeTruthy();
  });

  it('manda ID, chave e nome numa chamada só e leva o navegador à autorização; o botão espera tudo preenchido', async () => {
    api.getJson.mockResolvedValue(overview({ canConnect: false }));
    api.postJson.mockResolvedValue({ accountId: ACC, authorizeUrl: 'https://auth.mercadolivre.com.br/x' });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const user = setup();
    await user.click(await screen.findByRole('button', { name: /conectar mercado livre/i }));
    await user.click(screen.getByRole('button', { name: /já criei, continuar/i }));
    const go = screen.getByRole('button', { name: /autorizar no mercado livre/i }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await user.type(screen.getByLabelText(/id do aplicativo/i), ' 123 ');
    await user.type(screen.getByLabelText(/chave secreta/i), 'segredo');
    await user.type(screen.getByLabelText(/nome desta conta/i), '  Loja principal ');
    await user.click(go);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://auth.mercadolivre.com.br/x'));
    expect(api.postJson).toHaveBeenCalledWith('/api/marketplace/accounts', { label: 'Loja principal', clientId: '123', clientSecret: 'segredo' }, expect.any(String));
    vi.unstubAllGlobals();
  });

  it('app já cadastrado: só pede o nome da conta (sem credenciais)', async () => {
    api.getJson.mockResolvedValue(overview());
    api.postJson.mockResolvedValue({ accountId: ACC, authorizeUrl: 'https://auth/x' });
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    const user = setup();
    await user.click(await screen.findByRole('button', { name: /conectar mercado livre/i }));
    expect(screen.queryByLabelText(/chave secreta/i)).toBeNull();
    await user.type(screen.getByLabelText(/nome desta conta/i), 'Loja');
    await user.click(screen.getByRole('button', { name: /autorizar no mercado livre/i }));
    await waitFor(() => expect(api.postJson).toHaveBeenCalledWith('/api/marketplace/accounts', { label: 'Loja' }, expect.any(String)));
    vi.unstubAllGlobals();
  });

  it('erro do serviço aparece dentro da janela, em palavras, e a janela continua aberta', async () => {
    api.getJson.mockResolvedValue(overview());
    api.postJson.mockRejectedValue(new Error('o plano não inclui app próprio'));
    const user = setup();
    await user.click(await screen.findByRole('button', { name: /conectar mercado livre/i }));
    await user.type(screen.getByLabelText(/nome desta conta/i), 'Loja');
    await user.click(screen.getByRole('button', { name: /autorizar no mercado livre/i }));
    expect(await screen.findByText(/o plano não inclui app próprio/i)).toBeTruthy();
    expect(screen.getByLabelText(/nome desta conta/i)).toBeTruthy();
  });

  it('mostra o estado de cada conta; desconectar pede confirmação antes de chamar a API', async () => {
    api.getJson.mockResolvedValue(overview({ accounts: [{ id: ACC, label: 'Loja', state: 'active', displayName: 'MAX ESHOP', connection: { id: 'c1', state: 'active' } }] }));
    api.deleteJson.mockResolvedValue({});
    const user = setup();
    expect(await screen.findByText('Conectada')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^desconectar$/i }));
    expect(api.deleteJson).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^desconectar$/i }));
    await waitFor(() => expect(api.deleteJson).toHaveBeenCalledWith(`/api/marketplace/accounts/${ACC}`, expect.any(String)));
  });

  it('conta que precisa de nova autorização oferece reconectar', async () => {
    api.getJson.mockResolvedValue(overview({ accounts: [{ id: ACC, label: 'Loja', state: 'reauth_required', displayName: null, connection: null }] }));
    api.postJson.mockResolvedValue({ accountId: ACC, authorizeUrl: 'https://auth/x' });
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    const user = setup();
    await user.click(await screen.findByRole('button', { name: /reconectar/i }));
    await waitFor(() => expect(api.postJson).toHaveBeenCalledWith(`/api/marketplace/accounts/${ACC}/reauthorize`, {}, expect.any(String)));
    vi.unstubAllGlobals();
  });

  it('volta autorizada do Mercado Livre: vincula a conta uma vez e limpa a URL', async () => {
    nav.params = new URLSearchParams({ status: 'active', accountId: ACC });
    api.getJson.mockResolvedValue(overview());
    api.postJson.mockResolvedValue({});
    setup();
    await waitFor(() => expect(api.postJson).toHaveBeenCalledWith(`/api/marketplace/accounts/${ACC}/link`, {}, expect.any(String)));
    expect(api.postJson).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith('/configuracoes/marketplaces');
    expect(await screen.findByText(/conta autorizada/i)).toBeTruthy();
  });

  it('volta negada: mostra o motivo e não vincula nada', async () => {
    nav.params = new URLSearchParams({ status: 'error', reason: 'denied' });
    api.getJson.mockResolvedValue(overview());
    setup();
    expect(await screen.findByText(/autorização foi negada/i)).toBeTruthy();
    expect(api.postJson).not.toHaveBeenCalled();
  });
});
