import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../auth/permissions.catalog.js';
import { REQUIRED_PERMISSION } from '../auth/permissions.js';
import { MarketplaceClient } from './marketplace.client.js';
import { MarketplaceController } from './marketplace.controller.js';
import type { MarketplaceSettings } from './marketplace.config.js';
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
});

describe('MarketplaceService', () => {
  const request = vi.fn();
  const client = { enabled: true, request } as unknown as MarketplaceClient;
  const service = () => new MarketplaceService(client, cfg);
  beforeEach(() => request.mockReset());

  it('sem configuração: a visão diz "desligado" e nada é chamado; as ações recusam com 503', async () => {
    const off = new MarketplaceService({ enabled: false, request } as never, cfg);
    expect(await off.overview(ORG)).toMatchObject({ enabled: false, accounts: [] });
    await expect(off.connect(ORG, 'Loja')).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
  });

  it('a visão mostra só contas do provider e não revogadas, sem nada além do estado', async () => {
    request.mockImplementation(async (_o: string, _m: string, path: string) =>
      path === '/v1/accounts'
        ? { items: [
            { id: ACC, provider: 'mercadolivre', label: 'Loja', state: 'active', displayName: 'MAX', token: 'x', connection: { id: 'c1', storeId: ORG, state: 'active' } },
            { id: 'r', provider: 'mercadolivre', label: 'Velha', state: 'revoked', displayName: null, connection: null },
            { id: 'o', provider: 'shopee', label: 'Outra', state: 'active', displayName: null, connection: null },
          ] }
        : { items: [{ id: 'app', provider: 'mercadolivre', status: 'active' }] },
    );
    const view = await service().overview(ORG);
    expect(view.canConnect).toBe(true);
    expect(view.accounts).toEqual([{ id: ACC, label: 'Loja', state: 'active', displayName: 'MAX', connection: { id: 'c1', state: 'active' } }]);
  });

  it('conectar usa o app ativo do provider e a returnUrl configurada', async () => {
    request.mockResolvedValueOnce({ items: [{ id: 'app-1', provider: 'mercadolivre', status: 'active' }] }).mockResolvedValueOnce({ accountId: ACC, authorizeUrl: 'https://ml/auth' });
    expect(await service().connect(ORG, 'Loja')).toEqual({ accountId: ACC, authorizeUrl: 'https://ml/auth' });
    expect(request).toHaveBeenLastCalledWith(ORG, 'POST', '/v1/accounts', { provider: 'mercadolivre', appId: 'app-1', label: 'Loja', returnUrl: cfg.returnUrl });
  });

  it('sem app liberado: 409 com mensagem clara e nenhuma conta criada', async () => {
    request.mockResolvedValueOnce({ items: [] });
    await expect(service().connect(ORG, 'Loja')).rejects.toMatchObject({ status: 409 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('vincular usa a organização como loja', async () => {
    request.mockResolvedValue({});
    await service().link(ORG, ACC);
    expect(request).toHaveBeenCalledWith(ORG, 'PUT', `/v1/connections/${ORG}/mercadolivre`, { accountId: ACC });
  });

  it('recusa do serviço (403) chega à pessoa; falha de rede vira 503 sem vazar detalhe', async () => {
    const { MarketplaceRequestError } = await import('./marketplace.client.js');
    request.mockRejectedValueOnce(new MarketplaceRequestError(403, 'forbidden', 'a organização não tem o direito marketplace.provider.mercadolivre'));
    await expect(service().revoke(ORG, ACC)).rejects.toMatchObject({ status: 403 });
    request.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.5:3600'));
    const err = (await service().revoke(ORG, ACC).catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(503);
    expect(JSON.stringify(err.getResponse())).not.toContain('10.0.0.5');
  });
});

describe('MarketplaceController', () => {
  const service = { overview: vi.fn(), connect: vi.fn(), reauthorize: vi.fn(), link: vi.fn(), revoke: vi.fn(), setConnectionState: vi.fn() };
  const controller = new MarketplaceController(service as never);
  const req = { principal: { tenantId: ORG } };
  beforeEach(() => Object.values(service).forEach((f) => f.mockReset().mockResolvedValue({})));

  it('a organização vem do Principal; o nome da conta é validado', async () => {
    await controller.connect({ label: '  Loja  ' }, req);
    expect(service.connect).toHaveBeenCalledWith(ORG, 'Loja');
    expect(() => controller.connect({ label: '' }, req)).toThrow(/nome/i);
    expect(() => controller.connect({ label: 'x', orgId: 'outra' }, req)).toThrow();
  });

  it('toda rota exige permissão que existe no catálogo; ler é uma, mudar é outra', () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    const proto = MarketplaceController.prototype as unknown as Record<string, object>;
    const required = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor').map((n) => Reflect.getMetadata(REQUIRED_PERMISSION, proto[n]!));
    expect(required.every((k) => keys.has(k))).toBe(true);
    expect(required.filter((k) => k === 'marketplace.read')).toHaveLength(1);
    expect(required.filter((k) => k === 'marketplace.manage')).toHaveLength(6);
  });
});
