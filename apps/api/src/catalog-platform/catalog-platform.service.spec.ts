import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CatalogPlatformService, type CallerContext } from './catalog-platform.service.js';
import type { PartsSearchSettings } from './parts-search.config.js';

const CATALOG = 'rocket-autopecas';
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const caller = (over: Partial<CallerContext> = {}): CallerContext => ({ token: 'user-jwt', orgId: ORG_A, storeId: ORG_A, ...over });

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const apiError = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: 'texto interno da plataforma', requestId: 'req-7' } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const lookupOk = { items: [], missing: ['a'] };

const settings = (over: Partial<PartsSearchSettings> = {}): PartsSearchSettings => ({
  baseUrl: 'https://catalog.example',
  timeoutMs: 1000,
  retries: 2,
  retryBaseMs: 1,
  retryMaxMs: 5,
  breakerThreshold: 3,
  breakerOpenMs: 10_000,
  maxConcurrent: 8,
  maxQueue: 0,
  ...over,
});

type Responder = (req: Request, call: number) => Response | Promise<Response>;
function build(responder: Responder, over: Partial<PartsSearchSettings> = {}) {
  let calls = 0;
  const fetch = vi.fn(async (req: Request) => responder(req, ++calls));
  const service = new CatalogPlatformService(settings(over), fetch as unknown as typeof globalThis.fetch);
  return { service, fetch };
}
const status = (e: unknown) => (e instanceof HttpException ? e.getStatus() : -1);
const fail = async (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e);

describe('CatalogPlatformService: classificação fiscal (da organização, sem loja: ADR-10 da plataforma)', () => {
  const path = (req: Request) => new URL(req.url).pathname;

  it('fiscalResolve: POST /v1/fiscal:resolve com o token do usuário e a organização, sem descobrir loja', async () => {
    const { service, fetch } = build(() => json({ items: [], unknown: ['a'] }));
    const out = await service.fiscalResolve(caller({ storeId: undefined }), ['a']);
    expect(out).toEqual({ items: [], unknown: ['a'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const req = fetch.mock.calls[0]![0];
    expect(req.method).toBe('POST');
    expect(path(req)).toBe('/v1/fiscal:resolve');
    expect(await req.clone().json()).toEqual({ skus: ['a'] });
    expect(req.headers.get('authorization')).toBe('Bearer user-jwt');
    expect(req.headers.get('x-org-id')).toBe(ORG_A);
  });

  it('fiscalObservations: POST em /v1/fiscal-observations com Idempotency-Key e os itens', async () => {
    const { service, fetch } = build(() => json({ accepted: 1, duplicates: 0, rejected: [] }, { status: 202 }));
    const item = { sku: 'a', accessKey: '0'.repeat(44), issuerCnpj: '12345678000195', observedAt: '2026-10-20T10:00:00Z', source: 'NFE_XML' as const, ncm: '68138110' };
    await service.fiscalObservations(caller(), [item], 'fixer-invoice-1-0');
    const req = fetch.mock.calls[0]![0];
    expect(path(req)).toBe('/v1/fiscal-observations');
    expect(req.headers.get('idempotency-key')).toBe('fixer-invoice-1-0');
    expect(await req.clone().json()).toEqual({ items: [item] });
  });

  it('403 (sem fiscal:write) vira erro tratado, sem vazar a mensagem da plataforma', async () => {
    const { service } = build(() => apiError(403, 'forbidden'));
    const e = await fail(service.fiscalObservations(caller(), [], 'k'));
    expect(status(e)).toBe(403);
    expect(JSON.stringify((e as HttpException).getResponse())).not.toContain('texto interno da plataforma');
  });
});

describe('CatalogPlatformService: diretório de veículos', () => {
  const url = (fetch: ReturnType<typeof build>['fetch']) => new URL(fetch.mock.calls[0]![0].url);

  it('cascata: GET vehicles com montadora, modelo e ano', async () => {
    const { service, fetch } = build(() => json({ makes: [] }));
    await service.vehicleFacets(caller(), CATALOG, { make: 'Fiat', model: 'Strada', year: 2016 });
    expect(url(fetch).pathname).toBe(`/v1/catalogs/${CATALOG}/vehicles`);
    expect(Object.fromEntries(url(fetch).searchParams)).toEqual({ make: 'Fiat', model: 'Strada', year: '2016' });
  });

  it('texto livre: GET vehicles:resolve com q e limite', async () => {
    const { service, fetch } = build(() => json({ data: [] }));
    await service.resolveVehicles(caller(), CATALOG, 'gol 1.6 2015', 5);
    expect(url(fetch).pathname).toBe(`/v1/catalogs/${CATALOG}/vehicles:resolve`);
    expect(Object.fromEntries(url(fetch).searchParams)).toEqual({ q: 'gol 1.6 2015', limit: '5' });
  });

  it('um veículo: GET vehicles/{id}; 404 da plataforma vira 404 tratado', async () => {
    const { service, fetch } = build(() => apiError(404, 'not_found'));
    expect(status(await fail(service.vehicle(caller(), CATALOG, 'v-1')))).toBe(404);
    expect(url(fetch).pathname).toBe(`/v1/catalogs/${CATALOG}/vehicles/v-1`);
  });
});

describe('CatalogPlatformService: o que vai à plataforma', () => {
  it('consulta em lote por sku: POST no catálogo, com o token do usuário, a organização, a loja e o traceparent', async () => {
    const { service, fetch } = build(() => json(lookupOk));
    const out = await service.lookupParts(caller({ traceparent: '00-abc-def-01' }), CATALOG, ['a']);
    expect(out).toEqual(lookupOk);
    const req = fetch.mock.calls[0]![0];
    expect(req.method).toBe('POST');
    expect(new URL(req.url).pathname).toBe(`/v1/catalogs/${CATALOG}/parts:lookup`);
    expect(await req.clone().json()).toEqual({ skus: ['a'] });
    expect(req.headers.get('authorization')).toBe('Bearer user-jwt');
    expect(req.headers.get('x-org-id')).toBe(ORG_A);
    expect(req.headers.get('x-store-id')).toBe(ORG_A);
    expect(req.headers.get('traceparent')).toBe('00-abc-def-01');
  });

  it('consulta por GTIN: POST em barcodes:lookup', async () => {
    const { service, fetch } = build(() => json({ matches: [{ barcode: '7891234567890', skus: ['a'] }] }));
    expect((await service.lookupBarcodes(caller(), CATALOG, ['7891234567890'])).matches[0]!.skus).toEqual(['a']);
    expect(new URL(fetch.mock.calls[0]![0].url).pathname).toBe(`/v1/catalogs/${CATALOG}/barcodes:lookup`);
  });

  it('busca: GET com os parâmetros de consulta', async () => {
    const { service, fetch } = build(() => json({ data: [], page: 1, limit: 20, total: 0, totalPages: 0, truncated: false, facets: { brands: [], categories: [], prices: [] }, rankingProfile: 'v1' }));
    await service.search(caller(), CATALOG, { q: 'bieleta', page: 2, limit: 10, brandKey: ['FIAT', 'VW'] });
    const url = new URL(fetch.mock.calls[0]![0].url);
    expect(fetch.mock.calls[0]![0].method).toBe('GET');
    expect(url.pathname).toBe(`/v1/catalogs/${CATALOG}/search`);
    expect(url.searchParams.get('q')).toBe('bieleta');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.getAll('brandKey')).toEqual(['FIAT', 'VW']);
  });

  it('autocomplete: GET com q e limit', async () => {
    const { service, fetch } = build(() => json({ data: [], rankingProfile: 'v1' }));
    await service.autocomplete(caller(), CATALOG, { q: 'biel', limit: 5 });
    const url = new URL(fetch.mock.calls[0]![0].url);
    expect(url.pathname).toBe(`/v1/catalogs/${CATALOG}/autocomplete`);
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('sem token: falha antes de ir à rede (e é 502, não 401: a sessão do Fixer não é o problema)', async () => {
    const { service, fetch } = build(() => json(lookupOk));
    const e = await fail(service.lookupParts(caller({ token: '' }), CATALOG, ['a']));
    expect(status(e)).toBe(502);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('CatalogPlatformService: erros e repetição', () => {
  it('503 transitório: repete e dá certo (leitura é idempotente, inclusive o POST de consulta)', async () => {
    const { service, fetch } = build((_r, n) => (n === 1 ? apiError(503, 'search_unavailable') : json(lookupOk)));
    await expect(service.lookupParts(caller(), CATALOG, ['a'])).resolves.toEqual(lookupOk);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('503 persistente: esgota as tentativas (1 + retries) e responde 503 rotulado, sem vazar o texto da plataforma', async () => {
    const { service, fetch } = build(() => apiError(503, 'search_unavailable'), { breakerThreshold: 99 });
    const e = await fail(service.lookupParts(caller(), CATALOG, ['a']));
    expect(status(e)).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.stringify((e as HttpException).getResponse())).not.toContain('texto interno');
  });

  it.each([
    [400, 'invalid_request', 400],
    [401, 'unauthorized', 502], // a plataforma recusou o token que o Fixer aceitou: configuração, não sessão
    [403, 'forbidden', 403],
    [404, 'not_found', 404],
  ])('%i não é repetido e chega ao usuário como %i', async (st, code, expected) => {
    const { service, fetch } = build(() => apiError(st, code));
    expect(status(await fail(service.lookupParts(caller(), CATALOG, ['a'])))).toBe(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('500 da plataforma não é repetido e vira 502', async () => {
    const { service, fetch } = build(() => apiError(500, 'internal'), { breakerThreshold: 99 });
    expect(status(await fail(service.lookupParts(caller(), CATALOG, ['a'])))).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('429 com Retry-After curto é respeitado e repetido', async () => {
    const { service, fetch } = build((_r, n) => (n === 1 ? apiError(429, 'rate_limited', { 'retry-after': '0' }) : json(lookupOk)));
    await expect(service.lookupParts(caller(), CATALOG, ['a'])).resolves.toEqual(lookupOk);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('429 com Retry-After acima do teto não segura a requisição: responde 429 na hora', async () => {
    const { service, fetch } = build(() => apiError(429, 'rate_limited', { 'retry-after': '60' }));
    expect(status(await fail(service.lookupParts(caller(), CATALOG, ['a'])))).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('erro de rede é repetido; persistente vira 503', async () => {
    const { service, fetch } = build((_r, n) => {
      if (n < 3) throw new TypeError('fetch failed');
      return json(lookupOk);
    });
    await expect(service.lookupParts(caller(), CATALOG, ['a'])).resolves.toEqual(lookupOk);
    expect(fetch).toHaveBeenCalledTimes(3);

    const down = build(() => {
      throw new TypeError('fetch failed');
    }, { breakerThreshold: 99 });
    expect(status(await fail(down.service.lookupParts(caller(), CATALOG, ['a'])))).toBe(503);
  });

  it('tempo limite: a chamada que não responde é abortada e vira 503', async () => {
    const hang: Responder = (req) => new Promise<Response>((_res, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason)));
    const { service } = build(hang, { timeoutMs: 20, retries: 0 });
    expect(status(await fail(service.lookupParts(caller(), CATALOG, ['a'])))).toBe(503);
  });

  it('defeito de programação sobe como está (não vira 503 enganoso)', async () => {
    const { service } = build(() => {
      throw new RangeError('bug');
    });
    expect(await fail(service.lookupParts(caller(), CATALOG, ['a']))).toBeInstanceOf(RangeError);
  });

  it('o token do usuário nunca aparece no erro devolvido', async () => {
    const { service } = build(() => apiError(503, 'search_unavailable'), { breakerThreshold: 99 });
    const e = await fail(service.lookupParts(caller({ token: 'segredo-do-usuario' }), CATALOG, ['a']));
    expect(JSON.stringify((e as HttpException).getResponse())).not.toContain('segredo-do-usuario');
  });
});

describe('CatalogPlatformService: disjuntor e bulkhead', () => {
  it('abre após falhas consecutivas da plataforma e passa a responder 503 SEM chamar a rede', async () => {
    const { service, fetch } = build(() => apiError(503, 'search_unavailable'), { breakerThreshold: 3, retries: 2 });
    expect(status(await fail(service.lookupParts(caller(), CATALOG, ['a'])))).toBe(503); // 3 tentativas = 3 falhas = abre
    fetch.mockClear();
    expect(status(await fail(service.lookupParts(caller(), CATALOG, ['a'])))).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('é por organização: a falha de uma oficina não derruba a busca das outras', async () => {
    const { service, fetch } = build((req) => (req.headers.get('x-org-id') === ORG_A ? apiError(503, 'search_unavailable') : json(lookupOk)), { breakerThreshold: 3 });
    await fail(service.lookupParts(caller({ orgId: ORG_A }), CATALOG, ['a']));
    fetch.mockClear();
    await expect(service.lookupParts(caller({ orgId: ORG_B, storeId: ORG_B }), CATALOG, ['a'])).resolves.toEqual(lookupOk);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('erro do pedido (4xx) nunca abre o disjuntor', async () => {
    const { service } = build(() => apiError(404, 'not_found'), { breakerThreshold: 2 });
    for (let i = 0; i < 6; i++) expect(status(await fail(service.lookupParts(caller(), CATALOG, ['a'])))).toBe(404);
  });

  it('depois de breakerOpenMs deixa passar uma sonda e fecha se der certo', async () => {
    let healthy = false;
    const { service } = build(() => (healthy ? json(lookupOk) : apiError(503, 'search_unavailable')), { breakerThreshold: 1, retries: 0, breakerOpenMs: 25 });
    expect(status(await fail(service.lookupParts(caller(), CATALOG, ['a'])))).toBe(503);
    healthy = true;
    await new Promise((r) => setTimeout(r, 40));
    await expect(service.lookupParts(caller(), CATALOG, ['a'])).resolves.toEqual(lookupOk);
  });

  it('bulkhead: acima de maxConcurrent a chamada é recusada na hora com 503, sem ir à rede', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const { service, fetch } = build(async () => {
      await held;
      return json(lookupOk);
    }, { maxConcurrent: 1, maxQueue: 0, retries: 0 });
    const first = service.lookupParts(caller(), CATALOG, ['a']);
    await new Promise((r) => setTimeout(r, 5));
    expect(status(await fail(service.lookupParts(caller(), CATALOG, ['b'])))).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toEqual(lookupOk);
  });
});
