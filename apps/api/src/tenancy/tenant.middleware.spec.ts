import { PLATFORM_ROLE_SCOPES } from '@max-gateway/auth';
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PortalTenantMiddleware, TenantMiddleware } from './tenant.middleware.js';
import { TenantContext } from './tenant-context.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Roda o middleware e devolve a organização que o handler (`next`) enxergou. */
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

// Todo token do Keycloak traz `azp` (o client que o emitiu); o pacote recusa token sem ele.
const authWith = (payload: object | Error) => ({
  verify: vi.fn(async () => {
    if (payload instanceof Error) throw payload;
    return { azp: 'fixer-web', ...payload };
  }),
});

type Membership = { orgId: string; roles: string[] };
const directory = (memberships: Record<string, Membership[]>, over: { stores?: string[]; failing?: boolean } = {}) => ({
  membershipsOf: vi.fn(async (sub: string) => {
    if (over.failing) throw new Error('db down');
    return memberships[sub] ?? [];
  }),
  storesOf: vi.fn(async (orgId: string) => over.stores ?? [orgId]),
  catalogsOf: vi.fn(async () => ['rocket-autopecas']),
});

const build = (payload: object | Error, memberships: Record<string, Membership[]> = {}, over = {}) =>
  new TenantMiddleware(authWith(payload) as never, directory(memberships, over) as never, PLATFORM_ROLE_SCOPES as never);
const call = (mw: TenantMiddleware, headers: Record<string, string | string[]>) => mw.use({ headers } as never, {} as never, vi.fn());
const bearer = { authorization: 'Bearer t' };

describe('TenantMiddleware (identidade e organização pelo @max-gateway/auth)', () => {
  it('abre a organização do usuário para o resto da requisição e deixa o Principal na requisição', async () => {
    const mw = build({ sub: 'u1' }, { u1: [{ orgId: A, roles: ['stockist'] }] });
    const req: Record<string, unknown> = { headers: bearer };
    const { seen } = await run(mw, req);
    expect(seen).toBe(A);
    expect(req.jwt).toMatchObject({ sub: 'u1' });
    expect(req.principal).toMatchObject({ userId: 'u1', tenantId: A, storeId: A, roles: ['stockist'] });
    expect((req.principal as { scopes: string[] }).scopes).toContain('offer:write');
  });

  it('X-Org-Id escolhe entre as organizações do usuário', async () => {
    const mw = build({ sub: 'u1' }, { u1: [{ orgId: A, roles: [] }, { orgId: B, roles: [] }] });
    expect((await run(mw, { headers: { ...bearer, 'x-org-id': B } })).seen).toBe(B);
    expect((await run(mw, { headers: { ...bearer, 'x-org-id': ` ${B.toUpperCase()} ` } })).seen).toBe(B);
  });

  it('várias organizações sem X-Org-Id: 400', async () => {
    const mw = build({ sub: 'u1' }, { u1: [{ orgId: A, roles: [] }, { orgId: B, roles: [] }] });
    await expect(call(mw, bearer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('organização que o usuário não tem: 404 idêntico ao inexistente, e a requisição não segue', async () => {
    const mw = build({ sub: 'u1' }, { u1: [{ orgId: A, roles: [] }] });
    const next = vi.fn();
    await expect(mw.use({ headers: { ...bearer, 'x-org-id': B } } as never, {} as never, next)).rejects.toBeInstanceOf(NotFoundException);
    expect(next).not.toHaveBeenCalled();
  });

  it('o claim "organization" sozinho NUNCA concede acesso (o registro é a autoridade)', async () => {
    const mw = build({ sub: 'u1', organization: [A] }, {});
    await expect(call(mw, bearer)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('participação de OUTRO usuário não concede nada', async () => {
    const mw = build({ sub: 'u1' }, { u2: [{ orgId: A, roles: [] }] });
    await expect(call(mw, bearer)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('token sem organização nenhuma: 403 (não há mais organização padrão de instalação legada)', async () => {
    await expect(call(build({ sub: 'u1' }), bearer)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('registro de tenants indisponível: 503, nunca acesso concedido', async () => {
    const mw = build({ sub: 'u1' }, { u1: [{ orgId: A, roles: [] }] }, { failing: true });
    await expect(call(mw, bearer)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('cabeçalho X-Org-Id repetido: 400', async () => {
    const mw = build({ sub: 'u1' }, { u1: [{ orgId: A, roles: [] }] });
    await expect(call(mw, { ...bearer, 'x-org-id': [A, B] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sem token ou com token inválido segue SEM organização (o AuthGuard responde 401)', async () => {
    const sem = await run(build({}), { headers: {} });
    expect(sem.seen).toBeUndefined();
    const ruim = await run(build(new UnauthorizedException()), { headers: { authorization: 'Bearer lixo' } });
    expect(ruim.seen).toBeUndefined();
    expect(ruim.next).toHaveBeenCalledOnce();
  });

  it('esquema que não é Bearer segue sem organização', async () => {
    expect((await run(build({ sub: 'u1' }), { headers: { authorization: 'Basic abc' } })).seen).toBeUndefined();
  });
});

describe('PortalTenantMiddleware', () => {
  const portalDirectory = (map: Record<string, string>) => ({ orgForPortalToken: vi.fn(async (t: string) => map[t] ?? null) });

  it('a organização é a dona do token da URL', async () => {
    const mw = new PortalTenantMiddleware(portalDirectory({ tok1: A, tok2: B }) as never);
    expect((await run(mw, { originalUrl: '/portal/tok2/messages' })).seen).toBe(B);
    expect((await run(mw, { originalUrl: '/portal/tok1?x=1' })).seen).toBe(A);
  });

  it('token desconhecido responde 404 sem chamar o handler', async () => {
    const mw = new PortalTenantMiddleware(portalDirectory({}) as never);
    const next = vi.fn();
    await expect(mw.use({ originalUrl: '/portal/nope' } as never, {} as never, next)).rejects.toBeInstanceOf(NotFoundException);
    expect(next).not.toHaveBeenCalled();
  });
});
