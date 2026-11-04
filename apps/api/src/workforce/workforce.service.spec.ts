import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkforceService } from './workforce.service.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CALLER = { token: 'user-jwt', orgId: ORG, traceparent: '00-abc-def-01' };
const settings = { baseUrl: 'https://wf.example', timeoutMs: 500 };

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const service = (fetchImpl: typeof fetch, over: Partial<typeof settings> = {}) => new WorkforceService({ ...settings, ...over }, fetchImpl);
const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as HttpException;

describe('WorkforceService', () => {
  it('leva o token do usuário, a organização e o traceparent, e monta a querystring sem vazios', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { items: [], nextCursor: null }));
    await service(fetchImpl as never).listPeople(CALLER, { search: 'ana', status: 'active', cursor: undefined, limit: 50 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://wf.example/v1/people?search=ana&status=active&limit=50');
    expect(init.headers).toMatchObject({ authorization: 'Bearer user-jwt', 'x-org-id': ORG, traceparent: '00-abc-def-01' });
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('envia o corpo como JSON nas escritas', async () => {
    const fetchImpl = vi.fn(async () => reply(201, { id: 'p1' }));
    await service(fetchImpl as never).createPerson(CALLER, { cpf: '52998224725', name: 'Ana' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://wf.example/v1/people');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ cpf: '52998224725', name: 'Ana' });
  });

  it('roteia vínculo, função e desligamento para os caminhos do contrato', async () => {
    const fetchImpl = vi.fn(async () => reply(200, {}));
    const s = service(fetchImpl as never);
    await s.addEngagement(CALLER, 'p1', {});
    await s.assignPosition(CALLER, 'e1', {});
    await s.terminate(CALLER, 'e1', {});
    expect(fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0].replace('https://wf.example', ''))).toEqual([
      '/v1/people/p1/engagements',
      '/v1/engagements/e1/positions',
      '/v1/engagements/e1/terminate',
    ]);
  });

  it.each([
    [409, 'Já existe pessoa com este CPF na organização'],
    [422, 'Unidade inexistente ou inativa'],
    [404, 'Pessoa inexistente'],
    [400, 'Requisição inválida'],
  ])('repassa a mensagem do workforce quando o erro é do pedido (%i)', async (status, message) => {
    const err = await failure(service((async () => reply(status, { error: { code: 'x', message, requestId: 'r1' } })) as never).getPerson(CALLER, 'p1'));
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({ message, requestId: 'r1' });
  });

  it('401 da plataforma não vira 401 (o web pediria login em loop): é 502 com texto de configuração', async () => {
    const err = await failure(service((async () => reply(401, { error: { code: 'unauthorized', message: 'invalid audience' } })) as never).units(CALLER));
    expect(err.getStatus()).toBe(502);
    expect(JSON.stringify(err.getResponse())).not.toContain('invalid audience');
  });

  it('403 vira texto nosso, sem vazar o escopo que faltou', async () => {
    const err = await failure(service((async () => reply(403, { error: { code: 'forbidden', message: 'scope people:write' } })) as never).createPerson(CALLER, {}));
    expect(err.getStatus()).toBe(403);
    expect(JSON.stringify(err.getResponse())).not.toContain('people:write');
  });

  it('erro interno do workforce vira 502 sem detalhe', async () => {
    const err = await failure(service((async () => reply(500, { error: { code: 'internal_error', message: 'stack trace' } })) as never).positions(CALLER));
    expect(err.getStatus()).toBe(502);
    expect(JSON.stringify(err.getResponse())).not.toContain('stack trace');
  });

  it('sem resposta (rede ou tempo esgotado) é 503', async () => {
    const err = await failure(service((async () => Promise.reject(new TypeError('fetch failed'))) as never).units(CALLER));
    expect(err.getStatus()).toBe(503);
  });

  it('sem WORKFORCE_URL responde 503 sem tentar a rede', async () => {
    const fetchImpl = vi.fn();
    const err = await failure(service(fetchImpl as never, { baseUrl: '' }).units(CALLER));
    expect(err.getStatus()).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
