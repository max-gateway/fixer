import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../auth/permissions.catalog.js';
import { REQUIRED_PERMISSION } from '../auth/permissions.js';
import { MarketplaceClient, MarketplaceRequestError } from './marketplace.client.js';
import type { MarketplaceSettings } from './marketplace.config.js';
import { MarketplaceController } from './marketplace.controller.js';
import { MarketplaceService } from './marketplace.service.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cfg: MarketplaceSettings = { enabled: true, baseUrl: 'https://mk.test', tokenUrl: 'https://kc.test/token', clientId: 'fixer-marketplace', clientSecret: 's3', returnUrl: 'https://app.test/configuracoes/marketplaces', timeoutMs: 1000 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('MarketplaceClient', () => {
  const http = vi.fn();
  beforeEach(() => http.mockReset());
  const token = () => json(200, { access_token: 'tk', expires_in: 300 });

  it('pede o token por client credentials, guarda em cache e manda a organização em X-Org-Id', async () => {
    http.mockResolvedValueOnce(token()).mockResolvedValue(json(200, { items: [] }));
    const client = new MarketplaceClient(cfg, http as never);
    await client.request(ORG, 'GET', '/v1/accounts');
    await client.request(ORG, 'GET', '/v1/apps');
    const tokenCalls = http.mock.calls.filter(([url]) => url === cfg.tokenUrl);
    expect(tokenCalls).toHaveLength(1);
    expect((tokenCalls[0]![1].body as URLSearchParams).get('grant_type')).toBe('client_credentials');
    const [url, init] = http.mock.calls[1]!;
    expect(url).toBe('https://mk.test/v1/accounts');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tk', 'x-org-id': ORG });
  });

  it('um 401 descarta o token e repete UMA vez com outro', async () => {
    http.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(token()).mockResolvedValueOnce(json(200, { ok: 1 }));
    expect(await new MarketplaceClient(cfg, http as never).request(ORG, 'GET', '/v1/accounts')).toEqual({ ok: 1 });
  });

  it('erro do serviço vira MarketplaceRequestError com a mensagem do padrão da plataforma', async () => {
    http.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(403, { error: { code: 'forbidden', message: 'organização suspensa' } }));
    await expect(new MarketplaceClient(cfg, http as never).request(ORG, 'POST', '/v1/accounts', {})).rejects.toMatchObject({ status: 403, message: 'organização suspensa' });
  });

  it('cabeçalhos extras (If-Match) seguem na chamada', async () => {
    http.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(200, {}));
    await new MarketplaceClient(cfg, http as never).request(ORG, 'PUT', '/v1/settings', {}, { 'if-match': '"3"' });
    expect(http.mock.calls[1]![1].headers).toMatchObject({ 'if-match': '"3"' });
  });
});

describe('MarketplaceService', () => {
  const request = vi.fn();
  const client = { enabled: true, request } as unknown as MarketplaceClient;
  const service = () => new MarketplaceService(client, cfg);
  beforeEach(() => request.mockReset());

  const ML = { slug: 'mercadolivre', name: 'Mercado Livre' };
  const SHOPEE = { slug: 'shopee', name: 'Shopee' };
  const guide = { portalName: 'o portal', createStep: 'Crie.', idLabel: 'ID', idHint: 'a', secretLabel: 'Segredo', secretHint: 'b', permissions: 'c' };
  // O serviço entrega a apresentação pronta: o Fixer só repassa.
  const provider = (p: { slug: string; name: string }, over: { entitled?: boolean; platform?: boolean; own?: boolean } = {}) => ({
    ...p,
    entitled: over.entitled ?? true,
    appSources: { platform: over.platform ?? false, own: over.own ?? true },
    capabilities: ['auth', 'listings'],
    redirectUri: `https://mk.test/v1/oauth/${p.slug}/callback`,
    credentials: guide,
    options: [],
  });
  const status = { label: 'Conectada', tone: 'ok' };
  const app = (id: string, prov: string, source: 'tenant' | 'platform', status = 'active') => ({ id, provider: prov, status, source });
  const acc = (id: string, prov: string, state = 'active', connection: unknown = null) => ({ id, provider: prov, label: 'Loja', state, displayName: 'MAX', status, token: 'segredo', connection });

  function serve(map: { providers?: unknown[]; apps?: unknown[]; accounts?: unknown[]; settings?: unknown }) {
    request.mockImplementation(async (_o: string, method: string, path: string) => {
      if (method === 'GET' && path === '/v1/providers') return { items: map.providers ?? [], authorizationOutcomes: { active: { kind: 'ok', message: 'Conta autorizada.' } } };
      if (method === 'GET' && path === '/v1/apps') return { items: map.apps ?? [] };
      if (method === 'GET' && path === '/v1/accounts') return { items: map.accounts ?? [] };
      if (method === 'GET' && path === '/v1/settings') return map.settings ?? { document: {}, version: 0 };
      if (method === 'POST' && path === '/v1/accounts') return { accountId: ACC, authorizeUrl: 'https://mp/auth' };
      return {};
    });
  }
  const sent = () => request.mock.calls.map((c) => `${c[1]} ${c[2]}`);

  it('desligado: a visão diz "desligado", nada é chamado e as ações recusam com 503', async () => {
    const off = new MarketplaceService({ enabled: false, request } as never, cfg);
    expect(await off.overview(ORG)).toEqual({ enabled: false, providers: [], authorizationOutcomes: {} });
    await expect(off.connect(ORG, 'mercadolivre', 'Loja')).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
  });

  it('a visão é montada com a lista de marketplaces do SERVIÇO (qualquer um), sem token, com as contas de cada um e o endereço de retorno por marketplace', async () => {
    serve({
      providers: [provider(ML, { platform: true }), provider(SHOPEE, { own: false })],
      apps: [app('p1', 'mercadolivre', 'platform')],
      accounts: [acc(ACC, 'mercadolivre', 'active', { id: 'c1', storeId: ORG, state: 'active' }), acc('r', 'mercadolivre', 'revoked'), acc('s', 'shopee', 'reauth_required')],
    });
    const view = await service().overview(ORG);
    expect(view.providers.map((p) => [p.slug, p.ready, p.canUseOwnApp, p.redirectUri])).toEqual([
      ['mercadolivre', true, true, 'https://mk.test/v1/oauth/mercadolivre/callback'],
      ['shopee', false, false, 'https://mk.test/v1/oauth/shopee/callback'],
    ]);
    expect(view.providers[0]!.accounts).toEqual([{ id: ACC, label: 'Loja', state: 'active', displayName: 'MAX', status, connection: { id: 'c1', state: 'active' } }]);
    // apresentação, endereço de retorno e textos do OAuth: do serviço, sem tradução no Fixer
    expect(view.providers[0]).toMatchObject({ credentials: guide, capabilities: ['auth', 'listings'], options: [] });
    expect(view.authorizationOutcomes.active!.message).toBe('Conta autorizada.');
    expect(view.providers[1]!.accounts.map((a) => a.state)).toEqual(['reauth_required']);
    expect(JSON.stringify(view)).not.toContain('segredo');
  });

  it('"pronto" exige o direito e um app utilizável: app compartilhado só vale se o serviço o oferece à oficina', async () => {
    serve({ providers: [provider(ML, { platform: false, own: true })], apps: [app('p1', 'mercadolivre', 'platform')] });
    expect((await service().overview(ORG)).providers[0]!.ready).toBe(false);
    serve({ providers: [provider(ML, { entitled: false, platform: true })], apps: [app('p1', 'mercadolivre', 'platform')] });
    expect((await service().overview(ORG)).providers[0]).toMatchObject({ ready: false, entitled: false, canUseOwnApp: false });
    serve({ providers: [provider(ML)], apps: [app('o1', 'mercadolivre', 'tenant')] });
    expect((await service().overview(ORG)).providers[0]!.ready).toBe(true);
  });

  it('conectar com app compartilhado da plataforma: sem pedir credenciais, usa o app da plataforma e registra a returnUrl', async () => {
    serve({ apps: [app('p1', 'mercadolivre', 'platform')] });
    expect(await service().connect(ORG, 'mercadolivre', 'Loja')).toEqual({ accountId: ACC, authorizeUrl: 'https://mp/auth' });
    expect(request).toHaveBeenCalledWith(ORG, 'POST', '/v1/accounts', { provider: 'mercadolivre', appId: 'p1', label: 'Loja', returnUrl: cfg.returnUrl });
    expect(sent()).toContain('PUT /v1/settings');
  });

  it('o app próprio da oficina tem preferência sobre o compartilhado', async () => {
    serve({ apps: [app('p1', 'mercadolivre', 'platform'), app('o1', 'mercadolivre', 'tenant')] });
    await service().connect(ORG, 'mercadolivre', 'Loja');
    expect(request).toHaveBeenCalledWith(ORG, 'POST', '/v1/accounts', expect.objectContaining({ appId: 'o1' }));
  });

  it('com as credenciais: cadastra o app da oficina (marketplace qualquer), registra a returnUrl e inicia, nesta ordem', async () => {
    let apps: unknown[] = [];
    request.mockImplementation(async (_o: string, method: string, path: string) => {
      if (method === 'POST' && path === '/v1/apps') {
        apps = [app('novo', 'shopee', 'tenant')];
        return {};
      }
      if (method === 'GET' && path === '/v1/apps') return { items: apps };
      if (method === 'GET' && path === '/v1/settings') return { document: {}, version: 0 };
      if (method === 'POST' && path === '/v1/accounts') return { accountId: ACC, authorizeUrl: 'https://mp/auth' };
      return {};
    });
    await service().connect(ORG, 'shopee', 'Loja', { clientId: 'cid', clientSecret: 'cs' });
    expect(sent()).toEqual(['GET /v1/apps', 'POST /v1/apps', 'GET /v1/apps', 'GET /v1/settings', 'PUT /v1/settings', 'POST /v1/accounts']);
    expect(request).toHaveBeenCalledWith(ORG, 'POST', '/v1/apps', { provider: 'shopee', label: expect.stringMatching(/^shopee-/), secrets: { clientId: 'cid', clientSecret: 'cs' } });
    expect(request).toHaveBeenLastCalledWith(ORG, 'POST', '/v1/accounts', expect.objectContaining({ provider: 'shopee', appId: 'novo' }));
  });

  it('com credenciais e app próprio já ativo: troca o segredo dele em vez de criar outro', async () => {
    serve({ apps: [app('o1', 'mercadolivre', 'tenant')] });
    await service().registerApp(ORG, 'mercadolivre', 'cid2', 'cs2');
    expect(request).toHaveBeenLastCalledWith(ORG, 'PUT', '/v1/apps/o1/secrets', { secrets: { clientId: 'cid2', clientSecret: 'cs2' } });
  });

  it('sem nenhum app utilizável: 409 claro e nenhuma conta criada', async () => {
    serve({ apps: [] });
    await expect(service().connect(ORG, 'mercadolivre', 'Loja')).rejects.toMatchObject({ status: 409 });
    expect(sent()).not.toContain('POST /v1/accounts');
  });

  it('a returnUrl é cadastrada uma vez, preservando o resto da configuração e usando If-Match; já cadastrada não regrava', async () => {
    serve({ apps: [app('p1', 'mercadolivre', 'platform')], settings: { document: { quota: { accountsMax: 2 }, oauth: { allowedReturnUrls: ['https://outra.test/x'] } }, version: 3 } });
    await service().connect(ORG, 'mercadolivre', 'Loja');
    expect(request).toHaveBeenCalledWith(ORG, 'PUT', '/v1/settings', { quota: { accountsMax: 2 }, oauth: { allowedReturnUrls: ['https://outra.test/x', cfg.returnUrl] } }, { 'if-match': '"3"' });
    request.mockClear();
    serve({ apps: [app('p1', 'mercadolivre', 'platform')], settings: { document: { oauth: { allowedReturnUrls: [cfg.returnUrl] } }, version: 4 } });
    await service().connect(ORG, 'mercadolivre', 'Loja');
    expect(sent()).not.toContain('PUT /v1/settings');
  });

  it('vincular usa o marketplace que o SERVIÇO diz ser da conta e a organização como loja', async () => {
    request.mockResolvedValueOnce({ id: ACC, provider: 'shopee' }).mockResolvedValue({});
    await service().link(ORG, ACC);
    expect(request).toHaveBeenLastCalledWith(ORG, 'PUT', `/v1/connections/${ORG}/shopee`, { accountId: ACC });
  });

  it('recusa do serviço (403) chega à pessoa; falha de rede vira 503 sem vazar detalhe', async () => {
    request.mockRejectedValueOnce(new MarketplaceRequestError(403, 'forbidden', 'o plano não inclui app próprio'));
    await expect(service().revoke(ORG, ACC)).rejects.toMatchObject({ status: 403 });
    request.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.5:3600'));
    const err = (await service().revoke(ORG, ACC).catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(503);
    expect(JSON.stringify(err.getResponse())).not.toContain('10.0.0.5');
  });
});

describe('MarketplaceController', () => {
  const service = { overview: vi.fn(), connect: vi.fn(), registerApp: vi.fn(), reauthorize: vi.fn(), link: vi.fn(), revoke: vi.fn(), setConnectionState: vi.fn() };
  const limits = { assertFeature: vi.fn() };
  const controller = new MarketplaceController(service as never, limits as never);
  const req = { principal: { tenantId: ORG } };
  beforeEach(() => {
    Object.values(service).forEach((f) => f.mockReset().mockResolvedValue({}));
    limits.assertFeature.mockReset().mockResolvedValue(undefined);
  });

  it('conectar: o marketplace vem da rota (validado), a organização do Principal; o direito do plano é conferido POR marketplace', async () => {
    await controller.connect('shopee', { label: '  Loja  ' }, req);
    expect(limits.assertFeature).toHaveBeenCalledWith('marketplace.provider.shopee');
    expect(service.connect).toHaveBeenCalledWith(ORG, 'shopee', 'Loja', undefined);
    await controller.connect('mercadolivre', { label: 'Loja', clientId: '1', clientSecret: 's' }, req);
    expect(service.connect).toHaveBeenLastCalledWith(ORG, 'mercadolivre', 'Loja', { clientId: '1', clientSecret: 's' });
  });

  it.each([
    ['nome vazio', 'shopee', { label: '' }, /nome/i],
    ['credencial pela metade', 'shopee', { label: 'x', clientId: '1' }, /juntos/],
    ['campo extra (a organização nunca vem do corpo)', 'shopee', { label: 'x', orgId: 'outra' }, /./],
    ['marketplace malformado', '../etc', { label: 'x' }, /Marketplace inválido/],
  ])('400 e nada é chamado: %s', async (_n, provider, body, message) => {
    await expect(controller.connect(provider, body, req)).rejects.toMatchObject({ status: 400 });
    await expect(controller.connect(provider, body, req)).rejects.toThrow(message);
    expect(service.connect).not.toHaveBeenCalled();
  });

  it('plano que desliga o marketplace (402) barra antes de falar com o serviço', async () => {
    limits.assertFeature.mockRejectedValue(new HttpException({ error: 'feature_not_in_plan' }, 402));
    await expect(controller.connect('shopee', { label: 'x' }, req)).rejects.toMatchObject({ status: 402 });
    await expect(controller.registerApp('shopee', { clientId: '1', clientSecret: 's' }, req)).rejects.toMatchObject({ status: 402 });
    expect(service.connect).not.toHaveBeenCalled();
    expect(service.registerApp).not.toHaveBeenCalled();
  });

  it('o app: Client ID e Secret são obrigatórios, nada volta na resposta e campo extra é recusado', async () => {
    expect(await controller.registerApp('mercadolivre', { clientId: ' 123 ', clientSecret: 'abc' }, req)).toBeUndefined();
    expect(service.registerApp).toHaveBeenCalledWith(ORG, 'mercadolivre', '123', 'abc');
    await expect(controller.registerApp('mercadolivre', { clientId: '', clientSecret: 'abc' }, req)).rejects.toThrow(/Client ID/);
    await expect(controller.registerApp('mercadolivre', { clientId: '1', clientSecret: 'a', extra: 1 }, req)).rejects.toThrow();
  });

  it('toda rota exige permissão que existe no catálogo; ler é uma, mudar é outra', () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    const proto = MarketplaceController.prototype as unknown as Record<string, object>;
    const required = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor').map((n) => Reflect.getMetadata(REQUIRED_PERMISSION, proto[n]!));
    expect(required.every((k) => keys.has(k))).toBe(true);
    expect(required.filter((k) => k === 'marketplace.read')).toHaveLength(1);
    expect(required.filter((k) => k === 'marketplace.manage')).toHaveLength(7);
  });
});
