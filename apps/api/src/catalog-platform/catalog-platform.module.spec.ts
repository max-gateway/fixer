import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CatalogPlatformModule } from './catalog-platform.module.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

/**
 * Integração do módulo: Nest de verdade (injeção, rotas, validação) falando com um servidor HTTP que faz o papel da plataforma, com o `fetch` real
 * e o `@max-gateway/catalog-client` real. O `TenantMiddleware` não entra: o teste só põe o Principal que ele poria.
 */
describe('CatalogPlatformModule (HTTP de ponta a ponta)', () => {
  let platform: Server;
  let app: INestApplication;
  let respond: (req: Seen) => { status: number; body: unknown; headers?: Record<string, string> };
  const seen: Seen[] = [];
  const previousEnv = { url: process.env.PARTS_SEARCH_URL, timeout: process.env.PARTS_SEARCH_TIMEOUT_MS };

  beforeAll(async () => {
    platform = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const s: Seen = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
        seen.push(s);
        const out = respond(s);
        res.writeHead(out.status, { 'content-type': 'application/json', ...out.headers });
        res.end(JSON.stringify(out.body));
      });
    });
    await new Promise<void>((resolve) => platform.listen(0, '127.0.0.1', resolve));
    process.env.PARTS_SEARCH_URL = `http://127.0.0.1:${(platform.address() as AddressInfo).port}`;
    process.env.PARTS_SEARCH_TIMEOUT_MS = '1000';

    const moduleRef = await Test.createTestingModule({ imports: [CatalogPlatformModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      req.principal = { tenantId: ORG, storeId: ORG, catalogs: ['rocket-autopecas'] };
      next();
    });
    await app.init();
  });
  afterAll(async () => {
    for (const [name, value] of [['PARTS_SEARCH_URL', previousEnv.url], ['PARTS_SEARCH_TIMEOUT_MS', previousEnv.timeout]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await app.close();
    await new Promise<void>((resolve) => platform.close(() => resolve()));
  });
  beforeEach(() => {
    seen.length = 0;
    respond = () => ({ status: 200, body: { items: [], missing: [] } });
  });

  const authed = (r: request.Test) => r.set('authorization', 'Bearer user-jwt').set('traceparent', '00-abc-def-01');

  it('busca: valida, chama a plataforma com o usuário, a organização e o traceparent, e devolve a resposta', async () => {
    respond = () => ({ status: 200, body: { data: [], page: 1, limit: 20, total: 0, totalPages: 0, truncated: false, facets: { brands: [], categories: [], prices: [] }, rankingProfile: 'v1' } });
    const res = await authed(request(app.getHttpServer()).get('/catalog/parts/search?q=bieleta&limit=10&brandKey=FIAT'));
    expect(res.status).toBe(200);
    expect(res.body.rankingProfile).toBe('v1');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('GET');
    expect(seen[0]!.url).toBe('/v1/catalogs/rocket-autopecas/search?q=bieleta&limit=10&brandKey=FIAT');
    expect(seen[0]!.headers.authorization).toBe('Bearer user-jwt');
    expect(seen[0]!.headers['x-org-id']).toBe(ORG);
    expect(seen[0]!.headers['x-store-id']).toBe(ORG);
    expect(seen[0]!.headers.traceparent).toBe('00-abc-def-01');
  });

  it('consulta em lote por sku e por GTIN', async () => {
    const parts = await authed(request(app.getHttpServer()).post('/catalog/parts/lookup').send({ skus: ['a', 'a', 'b'] }));
    expect(parts.status).toBe(200);
    expect(JSON.parse(seen[0]!.body)).toEqual({ skus: ['a', 'b'] });

    respond = () => ({ status: 200, body: { matches: [{ barcode: '7891234567890', skus: ['a'] }] } });
    const codes = await authed(request(app.getHttpServer()).post('/catalog/barcodes/lookup').send({ barcodes: ['7891234567890'] }));
    expect(codes.status).toBe(200);
    expect(codes.body.matches[0].skus).toEqual(['a']);
    expect(seen[1]!.url).toBe('/v1/catalogs/rocket-autopecas/barcodes:lookup');
  });

  it('pedido inválido é 400 e nem chega à plataforma', async () => {
    expect((await authed(request(app.getHttpServer()).get('/catalog/parts/search'))).status).toBe(400);
    expect((await authed(request(app.getHttpServer()).get('/catalog/parts/search?q=a&storeId=outra'))).status).toBe(400);
    expect((await authed(request(app.getHttpServer()).post('/catalog/parts/lookup').send({ skus: [] }))).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('sem Bearer: 401 e nada vai à plataforma', async () => {
    expect((await request(app.getHttpServer()).get('/catalog/parts/search?q=a')).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('erro do pedido na plataforma chega ao usuário traduzido e com o requestId, sem o texto interno', async () => {
    respond = () => ({ status: 404, body: { error: { code: 'not_found', message: 'texto interno', requestId: 'req-42' } } });
    const res = await authed(request(app.getHttpServer()).post('/catalog/parts/lookup').send({ skus: ['a'] }));
    expect(res.status).toBe(404);
    expect(res.body.requestId).toBe('req-42');
    expect(JSON.stringify(res.body)).not.toContain('texto interno');
    expect(seen).toHaveLength(1); // 404 não é repetido
  });

  it('plataforma indisponível: repete, e responde 503 rotulado', async () => {
    respond = () => ({ status: 503, body: { error: { code: 'search_unavailable', message: 'mongot fora', requestId: 'r' } } });
    const res = await authed(request(app.getHttpServer()).get('/catalog/parts/autocomplete?q=biel'));
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).toContain('indisponível');
    expect(seen.length).toBeGreaterThan(1); // 1 + retries
  });
});
