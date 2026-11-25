import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CnpjLookupClient } from './cnpj-lookup.client.js';
import type { CnpjLookupConfig } from './cnpj-lookup.config.js';

const KEY = 'mgk_live_abc123abc123.SEGREDO-QUE-NUNCA-PODE-IR-AO-LOG';
const CNPJ = '00000000000191';

const config = (over: Partial<CnpjLookupConfig> = {}): CnpjLookupConfig =>
  ({ serviceBaseUrl: 'https://gateway.maxgateway.com.br', apiKey: KEY, timeoutMs: 1000, ...over }) as CnpjLookupConfig;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let logged: string[];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  logged = [];
  const sink = (m: unknown, ...rest: unknown[]) => void logged.push([m, ...rest].map(String).join(' '));
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(sink);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(sink);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('esperava erro');
}

describe('CnpjLookupClient: caminho', () => {
  it('pela borda: manda X-Api-Key e consulta /v1/cnpj/{cnpj} na URL configurada', async () => {
    fetchMock.mockResolvedValue(json(200, { cnpj: CNPJ }));
    const r = await new CnpjLookupClient(config()).consultaCnpj(CNPJ);
    expect(r).toEqual({ cnpj: CNPJ });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://gateway.maxgateway.com.br/v1/cnpj/${CNPJ}`);
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe(KEY);
  });

  it('direto (sem chave configurada): nenhum cabeçalho de chave, como sempre foi', async () => {
    fetchMock.mockResolvedValue(json(200, { cnpj: CNPJ }));
    await new CnpjLookupClient(config({ serviceBaseUrl: 'http://cnpj_lookup:8082', apiKey: undefined })).consultaCnpj(CNPJ);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://cnpj_lookup:8082/v1/cnpj/${CNPJ}`);
    expect(init.headers).toEqual({});
  });

  it('o CNPJ vai codificado no caminho', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await new CnpjLookupClient(config()).consultaCnpj('12/ABC');
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/v1/cnpj/12%2FABC');
  });
});

describe('CnpjLookupClient: erros da borda comercial ({ error: { code, message, requestId } })', () => {
  const edge = (status: number, code: string) => json(status, { error: { code, message: 'texto interno da borda', requestId: 'req-1' } });

  it.each([
    [401, 'invalid_key'],
    [403, 'plan_no_api'],
    [403, 'account_suspended'],
    [403, 'plan_no_quota'],
    [403, 'ip_not_allowed'],
  ])('%i %s vira 502: o problema é a chave ou o plano do Fixer, e um 401 deslogaria a pessoa da oficina', async (status, code) => {
    fetchMock.mockResolvedValue(edge(status, code));
    const e = await failure(new CnpjLookupClient(config()).consultaCnpj(CNPJ));
    expect(e.getStatus()).toBe(502);
    expect(e.message).toBe('Serviço de consulta de CNPJ indisponível.');
    expect(e.message).not.toContain('borda');
  });

  it.each(['rate_limited', 'quota_exceeded'])('429 %s chega ao usuário como 429, com texto próprio e sem o texto interno', async (code) => {
    fetchMock.mockResolvedValue(edge(429, code));
    const e = await failure(new CnpjLookupClient(config()).consultaCnpj(CNPJ));
    expect(e.getStatus()).toBe(429);
    expect(e.message).toBe('Limite de consultas de CNPJ atingido. Tente novamente em instantes.');
  });

  it.each([502, 503, 504])('%i da infraestrutura da borda mantém o status e esconde o texto interno', async (status) => {
    fetchMock.mockResolvedValue(edge(status, 'edge_unavailable'));
    const e = await failure(new CnpjLookupClient(config()).consultaCnpj(CNPJ));
    expect(e.getStatus()).toBe(status);
    expect(e.message).toBe('Serviço de consulta de CNPJ indisponível.');
  });

  it('o log guarda o código e o requestId (para achar o caso na borda), nunca a chave', async () => {
    fetchMock.mockResolvedValue(edge(401, 'invalid_key'));
    await failure(new CnpjLookupClient(config()).consultaCnpj(CNPJ));
    const all = logged.join('\n');
    expect(all).toContain('invalid_key');
    expect(all).toContain('req-1');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain('SEGREDO');
  });
});

describe('CnpjLookupClient: erros do próprio serviço ({ detail }), comportamento inalterado', () => {
  it.each([
    [404, 'CNPJ não encontrado.'],
    [422, 'CNPJ inválido.'],
    [502, 'Erro no provedor.'],
  ])('%i repassa o status e a mensagem', async (status, detail) => {
    fetchMock.mockResolvedValue(json(status, { detail }));
    const e = await failure(new CnpjLookupClient(config({ apiKey: undefined })).consultaCnpj(CNPJ));
    expect(e.getStatus()).toBe(status);
    expect(e.message).toBe(detail);
  });

  it('um 401 que NÃO tem o formato da borda não é reescrito (só a borda é tratada como nossa credencial)', async () => {
    fetchMock.mockResolvedValue(json(401, { detail: 'Não autorizado.' }));
    const e = await failure(new CnpjLookupClient(config({ apiKey: undefined })).consultaCnpj(CNPJ));
    expect(e.getStatus()).toBe(401);
  });

  it('detail que não é texto (lista de validação do FastAPI) cai na mensagem genérica', async () => {
    fetchMock.mockResolvedValue(json(422, { detail: [{ msg: 'x' }] }));
    const e = await failure(new CnpjLookupClient(config({ apiKey: undefined })).consultaCnpj(CNPJ));
    expect(e.getStatus()).toBe(422);
    expect(e.message).toBe('Falha ao consultar CNPJ.');
  });

  it('corpo que não é JSON mantém o status com a mensagem genérica', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
    const e = await failure(new CnpjLookupClient(config()).consultaCnpj(CNPJ));
    expect(e.getStatus()).toBe(502);
    expect(e.message).toBe('Falha ao consultar CNPJ.');
  });
});

describe('CnpjLookupClient: rede', () => {
  it('falha de rede ou timeout vira 502 indisponível', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const e = await failure(new CnpjLookupClient(config()).consultaCnpj(CNPJ));
    expect(e.getStatus()).toBe(502);
    expect(e.message).toBe('Serviço de consulta de CNPJ indisponível.');
  });
});
