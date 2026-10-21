import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PortalTenantMiddleware, TenantMiddleware } from './tenant.middleware.js';
import { TenantContext } from './tenant-context.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Roda o middleware e devolve a organização que o handler (`next`) enxergou, e o que foi gravado na requisição. */
async function run(mw: { use: (...a: never[]) => Promise<void> }, req: Record<string, unknown>) {
  let seen: string | undefined = 'next-nao-chamado';
  const next = vi.fn(() => {
    seen = TenantContext.current();
  });
  TenantContext.useFallbackForTests(undefined); // o fallback dos testes mascararia a prova
  try {
    await mw.use(req as never, {} as never, next as never);
  } finally {
    TenantContext.useFallbackForTests('11111111-1111-4111-8111-111111111111');
  }
  return { seen, next };
}

const authWith = (payload: object | Error) => ({
  verify: vi.fn(async () => {
    if (payload instanceof Error) throw payload;
    return payload;
  }),
});
const membership = (map: Record<string, string[]>) => ({
  membershipsOf: vi.fn(async (sub: string) => (map[sub] ?? []).map((orgId) => ({ orgId, roles: ['member'] }))),
  storesOf: async () => [],
  catalogsOf: async () => [],
});
/** Token de usuário do app web: `azp` é o client que o originou. */
const user = (sub: string, extra: object = {}) => ({ sub, azp: 'fixer-web', ...extra });
const mwFor = (payload: object | Error, map: Record<string, string[]> = {}) => new TenantMiddleware(authWith(payload) as never, membership(map) as never);
const status = (e: unknown) => (e as { getStatus(): number }).getStatus();
const call = (mw: TenantMiddleware, headers: Record<string, string>, next = vi.fn()) => mw.use({ headers } as never, {} as never, next).catch((e: unknown) => e);

describe('TenantMiddleware (regras do @max-gateway/auth)', () => {
  it('abre a organização do registro de participação para o resto da requisição', async () => {
    const mw = mwFor(user('u'), { u: [A] });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer t' } };
    const { seen } = await run(mw, req);
    expect(seen).toBe(A);
    expect(req.jwt).toMatchObject({ sub: 'u' });
  });

  it('o claim `organization` NUNCA concede: sem participação a requisição é recusada e não segue', async () => {
    const next = vi.fn();
    const err = await call(mwFor(user('u', { organization: [A] })), { authorization: 'Bearer t' }, next);
    expect(status(err)).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('várias organizações: sem X-Org-Id é 400; X-Org-Id escolhe entre as do usuário', async () => {
    const mw = mwFor(user('u'), { u: [A, B] });
    expect(status(await call(mw, { authorization: 'Bearer t' }))).toBe(400);
    expect((await run(mw, { headers: { authorization: 'Bearer t', 'x-org-id': B } })).seen).toBe(B);
  });

  it('X-Org-Id de organização que o usuário não tem: 404 idêntico ao inexistente (nunca concede)', async () => {
    const next = vi.fn();
    const err = await call(mwFor(user('u'), { u: [A] }), { authorization: 'Bearer t', 'x-org-id': B }, next);
    expect(status(err)).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('participação de OUTRO usuário não concede nada', async () => {
    expect(status(await call(mwFor(user('u1'), { u2: [A] }), { authorization: 'Bearer t' }))).toBe(403);
  });

  it('token de serviço (mg_tenant) não abre contexto de oficina nesta API', async () => {
    const next = vi.fn();
    const err = await call(mwFor({ azp: 'job', mg_tenant: A }), { authorization: 'Bearer t' }, next);
    expect(status(err)).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('registro indisponível: 503 (nem "sem acesso" nem "com acesso" por engano)', async () => {
    const directory = {
      membershipsOf: async () => {
        throw new Error('db');
      },
      storesOf: async () => [],
      catalogsOf: async () => [],
    };
    const mw = new TenantMiddleware(authWith(user('u')) as never, directory as never);
    expect(status(await call(mw, { authorization: 'Bearer t' }))).toBe(503);
  });

  it('sem token ou com token inválido segue SEM organização (o AuthGuard responde 401)', async () => {
    const sem = await run(mwFor({}), { headers: {} });
    expect(sem.seen).toBeUndefined();
    const ruim = await run(mwFor(new UnauthorizedException()), { headers: { authorization: 'Bearer lixo' } });
    expect(ruim.seen).toBeUndefined();
    expect(ruim.next).toHaveBeenCalledOnce();
  });
});

describe('PortalTenantMiddleware', () => {
  const directory = (map: Record<string, string>) => ({ orgForPortalToken: vi.fn(async (t: string) => map[t] ?? null) });

  it('a organização é a dona do token da URL', async () => {
    const mw = new PortalTenantMiddleware(directory({ tok1: A, tok2: B }) as never);
    expect((await run(mw, { originalUrl: '/portal/tok2/messages' })).seen).toBe(B);
    expect((await run(mw, { originalUrl: '/portal/tok1?x=1' })).seen).toBe(A);
  });

  it('token desconhecido responde 404 sem chamar o handler', async () => {
    const mw = new PortalTenantMiddleware(directory({}) as never);
    const next = vi.fn();
    await expect(mw.use({ originalUrl: '/portal/nope' } as never, {} as never, next)).rejects.toBeInstanceOf(NotFoundException);
    expect(next).not.toHaveBeenCalled();
  });
});
