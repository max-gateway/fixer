// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationOutcomes, CredentialsGuide, MarketplaceAccount, MarketplaceOverview, MarketplaceProvider } from '@/lib/marketplace';

const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), deleteJson: vi.fn() }));
vi.mock('@/lib/client-api', async (orig) => ({ ...(await orig<typeof import('@/lib/client-api')>()), ...api }));
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.params, usePathname: () => '/configuracoes/marketplaces', useRouter: () => ({ replace: nav.replace }) }));

import { MarketplaceCard } from './marketplace-card';

const ACC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// O que o SERVIÇO entrega: o passo a passo de cada marketplace e o texto de cada resultado do OAuth. A tela não conhece nenhum marketplace.
const GUIDE: CredentialsGuide = {
  portalName: 'o painel de desenvolvedores do Mercado Livre',
  portalUrl: 'https://developers.mercadolivre.com.br/devcenter',
  createStep: 'Clique em “Criar nova aplicação”. No nome, pode usar o nome da sua empresa.',
  idLabel: 'ID do aplicativo',
  idHint: 'Aparece como “App ID”.',
  secretLabel: 'Chave secreta',
  secretHint: 'Aparece como “Secret Key”.',
  permissions: 'Deixe marcadas as permissões de leitura e de escrita.',
};
const OUTCOMES: AuthorizationOutcomes = {
  active: { kind: 'ok', message: 'Conta autorizada no marketplace.' },
  pending_profile: { kind: 'ok', message: 'Conta autorizada; o perfil do vendedor ainda está sendo lido.' },
  denied: { kind: 'error', message: 'A autorização foi negada no marketplace.' },
  error: { kind: 'error', message: 'Não foi possível concluir a autorização.' },
};
const provider = (over: Partial<MarketplaceProvider> = {}): MarketplaceProvider => ({
  slug: 'mercadolivre',
  name: 'Mercado Livre',
  entitled: true,
  ready: true,
  canUseOwnApp: true,
  redirectUri: 'https://mk.test/v1/oauth/mercadolivre/callback',
  capabilities: ['auth', 'listings'],
  credentials: GUIDE,
  accounts: [],
  ...over,
});
const account = (over: Partial<MarketplaceAccount> = {}): MarketplaceAccount => ({
  id: ACC,
  label: 'Loja',
  state: 'active',
  displayName: null,
  status: { label: 'Conectada', tone: 'ok' },
  connection: { id: 'c1', state: 'active' },
  ...over,
});
const overview = (...providers: MarketplaceProvider[]): MarketplaceOverview => ({ enabled: true, providers: providers.length ? providers : [provider()], authorizationOutcomes: OUTCOMES });

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
    api.getJson.mockResolvedValue({ enabled: false, providers: [], authorizationOutcomes: {} });
    setup();
    expect(await screen.findByText(/ainda não está disponível/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /conectar/i })).toBeNull();
  });

  it('uma seção por marketplace que a API devolve, qualquer que seja, cada uma com o seu botão', async () => {
    api.getJson.mockResolvedValue(overview(provider(), provider({ slug: 'shopee', name: 'Shopee', accounts: [account()] })));
    setup();
    expect(await screen.findByRole('heading', { name: 'Mercado Livre' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Shopee' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Conectar Mercado Livre' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Conectar outra conta' })).toBeTruthy();
  });

  it('marketplace fora do plano ou sem caminho de conexão: explica, sem botão que falharia', async () => {
    api.getJson.mockResolvedValue(
      overview(provider({ entitled: false, ready: false, canUseOwnApp: false }), provider({ slug: 'shopee', name: 'Shopee', ready: false, canUseOwnApp: false })),
    );
    setup();
    expect(await screen.findByText(/não está incluído no plano da sua oficina/i)).toBeTruthy();
    expect(screen.getByText(/ainda não está liberada para a sua oficina/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /conectar/i })).toBeNull();
  });

  it('sem app compartilhado nem próprio: o assistente explica a criação do app, mostra o endereço de retorno e só então pede os dados', async () => {
    api.getJson.mockResolvedValue(overview(provider({ ready: false })));
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

  it('marketplace novo: o passo a passo, os rótulos e o endereço vêm do serviço (nenhum texto por marketplace no Fixer), sem link quando o serviço não dá um', async () => {
    const guide: CredentialsGuide = { ...GUIDE, portalName: 'o portal do Novo Marketplace', portalUrl: undefined, createStep: 'Crie a aplicação pelo portal.', idLabel: 'Client ID', secretLabel: 'Client Secret' };
    api.getJson.mockResolvedValue(overview(provider({ slug: 'novomk', name: 'Novo Marketplace', ready: false, credentials: guide, redirectUri: 'https://mk.test/v1/oauth/novomk/callback' })));
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Conectar Novo Marketplace' }));
    expect(await screen.findByText(/o portal do Novo Marketplace/i)).toBeTruthy();
    expect(screen.getByText(/crie a aplicação pelo portal/i)).toBeTruthy();
    expect(screen.getByText('https://mk.test/v1/oauth/novomk/callback')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /abrir o painel/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /já criei, continuar/i }));
    expect(screen.getByLabelText(/client id/i)).toBeTruthy();
    expect(screen.getByLabelText(/client secret/i)).toBeTruthy();
  });

  it('serviço sem endereço público configurado: avisa em vez de mostrar um endereço vazio', async () => {
    api.getJson.mockResolvedValue(overview(provider({ ready: false, redirectUri: null })));
    const user = setup();
    await user.click(await screen.findByRole('button', { name: /conectar mercado livre/i }));
    expect(await screen.findByText(/endereço de retorno ainda não está configurado/i)).toBeTruthy();
  });

  it('manda ID, chave e nome numa chamada só, para o marketplace certo, e leva o navegador à autorização', async () => {
    api.getJson.mockResolvedValue(overview(provider({ ready: false })));
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
    expect(api.postJson).toHaveBeenCalledWith('/api/marketplace/providers/mercadolivre/accounts', { label: 'Loja principal', clientId: '123', clientSecret: 'segredo' }, expect.any(String));
    vi.unstubAllGlobals();
  });

  it('já dá para autorizar (app compartilhado da plataforma): só pede o nome da conta, sem credenciais', async () => {
    api.getJson.mockResolvedValue(overview(provider({ slug: 'shopee', name: 'Shopee' })));
    api.postJson.mockResolvedValue({ accountId: ACC, authorizeUrl: 'https://auth/x' });
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    const user = setup();
    await user.click(await screen.findByRole('button', { name: /conectar shopee/i }));
    expect(screen.queryByLabelText(/chave secreta/i)).toBeNull();
    await user.type(screen.getByLabelText(/nome desta conta/i), 'Loja');
    await user.click(screen.getByRole('button', { name: /autorizar no shopee/i }));
    await waitFor(() => expect(api.postJson).toHaveBeenCalledWith('/api/marketplace/providers/shopee/accounts', { label: 'Loja' }, expect.any(String)));
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
    api.getJson.mockResolvedValue(overview(provider({ accounts: [account({ displayName: 'MAX ESHOP' })] })));
    api.deleteJson.mockResolvedValue({});
    const user = setup();
    expect(await screen.findByText('Conectada')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^desconectar$/i }));
    expect(api.deleteJson).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^desconectar$/i }));
    await waitFor(() => expect(api.deleteJson).toHaveBeenCalledWith(`/api/marketplace/accounts/${ACC}`, expect.any(String)));
  });

  it('conta que precisa de nova autorização oferece reconectar', async () => {
    api.getJson.mockResolvedValue(overview(provider({ accounts: [account({ state: 'reauth_required', status: { label: 'Precisa reconectar', tone: 'bad' }, connection: null })] })));
    api.postJson.mockResolvedValue({ accountId: ACC, authorizeUrl: 'https://auth/x' });
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    const user = setup();
    await user.click(await screen.findByRole('button', { name: /reconectar/i }));
    await waitFor(() => expect(api.postJson).toHaveBeenCalledWith(`/api/marketplace/accounts/${ACC}/reauthorize`, {}, expect.any(String)));
    vi.unstubAllGlobals();
  });

  it('volta autorizada do marketplace: vincula a conta uma vez e limpa a URL', async () => {
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
