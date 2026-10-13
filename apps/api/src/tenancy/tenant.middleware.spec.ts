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

const authWith = (payload: object | Error) => ({ verify: vi.fn(async () => { if (payload instanceof Error) throw payload; return payload; }) });
const config = { orgsClaim: 'orgs', defaultOrgId: undefined as string | undefined };

describe('TenantMiddleware', () => {
  it('abre a organização do token para o resto da requisição', async () => {
    const mw = new TenantMiddleware(authWith({ sub: 'u', orgs: [A] }) as never, config as never);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer t' } };
    const { seen } = await run(mw, req);
    expect(seen).toBe(A);
    expect(req.jwt).toMatchObject({ sub: 'u' });
  });

  it('X-Org-Id escolhe entre as organizações do usuário', async () => {
    const mw = new TenantMiddleware(authWith({ orgs: [A, B] }) as never, config as never);
    expect((await run(mw, { headers: { authorization: 'Bearer t', 'x-org-id': B } })).seen).toBe(B);
  });

  it('organização fora do token é recusada e a requisição não segue', async () => {
    const mw = new TenantMiddleware(authWith({ orgs: [A] }) as never, config as never);
    const next = vi.fn();
    await expect(mw.use({ headers: { authorization: 'Bearer t', 'x-org-id': B } } as never, {} as never, next)).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it('sem token ou com token inválido segue SEM organização (o AuthGuard responde 401)', async () => {
    const sem = await run(new TenantMiddleware(authWith({}) as never, config as never), { headers: {} });
    expect(sem.seen).toBeUndefined();
    const ruim = await run(new TenantMiddleware(authWith(new UnauthorizedException()) as never, config as never), { headers: { authorization: 'Bearer lixo' } });
    expect(ruim.seen).toBeUndefined();
    expect(ruim.next).toHaveBeenCalledOnce();
  });
});

describe('TenantMiddleware com participação conhecida', () => {
  const membership = (map: Record<string, string[]>) => ({ orgsFor: vi.fn(async (sub: string) => map[sub] ?? []) });
  const call = (mw: TenantMiddleware, headers: Record<string, string>) => mw.use({ headers } as never, {} as never, vi.fn());

  it('token SEM claim, mas com participação: abre a organização (o claim do Keycloak some ao acaso)', async () => {
    const mw = new TenantMiddleware(authWith({ sub: 'u1' }) as never, config as never, membership({ u1: [A] }) as never);
    expect((await run(mw, { headers: { authorization: 'Bearer t' } })).seen).toBe(A);
  });

  it('várias oficinas só pela participação: exige X-Org-Id e aceita uma delas', async () => {
    const mw = new TenantMiddleware(authWith({ sub: 'u1' }) as never, config as never, membership({ u1: [A, B] }) as never);
    await expect(call(mw, { authorization: 'Bearer t' })).rejects.toThrow();
    expect((await run(mw, { headers: { authorization: 'Bearer t', 'x-org-id': B } })).seen).toBe(B);
  });

  it('participação de OUTRO usuário não concede nada', async () => {
    const mw = new TenantMiddleware(authWith({ sub: 'u1' }) as never, config as never, membership({ u2: [A] }) as never);
    await expect(call(mw, { authorization: 'Bearer t' })).rejects.toThrow();
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
