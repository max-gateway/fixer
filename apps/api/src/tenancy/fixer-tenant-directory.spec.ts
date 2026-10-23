import { describe, expect, it, vi } from 'vitest';
import { FixerTenantDirectory } from './fixer-tenant-directory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Row = { orgId: string; active: boolean; roles: { role: { permissions: { permission: { key: string } }[] } }[] };
const row = (orgId: string, keys: string[], active = true): Row => ({
  orgId,
  active,
  roles: [{ role: { permissions: keys.map((key) => ({ permission: { key } })) } }],
});

function build(opts: { orgs?: Record<string, string[]>; users?: Row[]; catalogs?: string[]; now?: () => number } = {}) {
  const orgsFor = vi.fn(async (sub: string) => opts.orgs?.[sub] ?? []);
  const findMany = vi.fn(async () => opts.users ?? []);
  const directory = new FixerTenantDirectory(
    { user: { findMany } } as never,
    { orgsFor } as never,
    { catalogs: opts.catalogs ?? ['rocket-autopecas'] } as never,
    opts.now,
  );
  return { directory, orgsFor, findMany };
}

describe('FixerTenantDirectory.membershipsOf', () => {
  it('sem participação em nenhuma organização: vazio, e nem consulta papéis', async () => {
    const { directory, findMany } = build();
    expect(await directory.membershipsOf('ninguem')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('traduz as permissões do usuário em CADA organização para o papel da plataforma', async () => {
    const { directory } = build({
      orgs: { u1: [A, B] },
      users: [row(A, ['pricing.write']), row(B, ['invoices.reconcile'])],
    });
    expect(await directory.membershipsOf('u1')).toEqual([
      { orgId: A, roles: ['price_manager'] },
      { orgId: B, roles: ['stockist'] },
    ]);
  });

  it('participa da organização mas ainda não tem usuário (convidado que não entrou): só consulta (viewer)', async () => {
    const { directory } = build({ orgs: { u1: [A] }, users: [] });
    expect(await directory.membershipsOf('u1')).toEqual([{ orgId: A, roles: ['viewer'] }]);
  });

  it('usuário desativado mantém a participação mas sem papel algum (nenhum escopo)', async () => {
    const { directory } = build({ orgs: { u1: [A] }, users: [row(A, ['pricing.write'], false)] });
    expect(await directory.membershipsOf('u1')).toEqual([{ orgId: A, roles: [] }]);
  });

  it('junta as permissões de todos os papéis de negócio do usuário', async () => {
    const two: Row = { orgId: A, active: true, roles: [{ role: { permissions: [{ permission: { key: 'invoices.reconcile' } }] } }, { role: { permissions: [{ permission: { key: 'pricing.write' } }] } }] };
    const { directory } = build({ orgs: { u1: [A] }, users: [two] });
    expect(await directory.membershipsOf('u1')).toEqual([{ orgId: A, roles: ['price_manager'] }]);
  });

  it('consulta só as organizações do usuário e normaliza o UUID para minúsculas', async () => {
    const { directory, findMany } = build({ orgs: { u1: [A.toUpperCase()] }, users: [row(A, [])] });
    expect((await directory.membershipsOf('u1'))[0]?.orgId).toBe(A);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { keycloakId: 'u1', orgId: { in: [A] } } }));
  });

  it('cache curto por usuário: a segunda chamada não vai ao banco; passado o TTL, vai', async () => {
    let t = 0;
    const { directory, findMany } = build({ orgs: { u1: [A] }, users: [row(A, [])], now: () => t });
    await directory.membershipsOf('u1');
    await directory.membershipsOf('u1');
    expect(findMany).toHaveBeenCalledTimes(1);
    t += 31_000;
    await directory.membershipsOf('u1');
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('falha do banco propaga (o pacote responde 503; nunca concede por engano)', async () => {
    const directory = new FixerTenantDirectory(
      { user: { findMany: vi.fn().mockRejectedValue(new Error('db down')) } } as never,
      { orgsFor: async () => [A] } as never,
      { catalogs: [] } as never,
    );
    await expect(directory.membershipsOf('u1')).rejects.toThrow('db down');
  });
});

describe('FixerTenantDirectory.storesOf / catalogsOf', () => {
  it('uma loja implícita por organização: o próprio id da organização', async () => {
    const { directory } = build();
    expect(await directory.storesOf(A.toUpperCase())).toEqual([A]);
  });

  it('catálogos vêm da configuração', async () => {
    const { directory } = build({ catalogs: ['rocket-autopecas', 'outro'] });
    expect(await directory.catalogsOf(A)).toEqual(['rocket-autopecas', 'outro']);
  });
});
