import { describe, expect, it, vi } from 'vitest';
import { FixerTenantDirectory } from './fixer-tenant-directory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type User = { orgId: string; active: boolean };

/** `projected`: papéis de plataforma por organização, como o control plane os projetou (sub → org → papéis). */
function build(opts: { projected?: Record<string, Record<string, string[]>>; users?: User[]; catalogs?: string[]; now?: () => number } = {}) {
  const platformRolesFor = vi.fn(async (sub: string) => new Map(Object.entries(opts.projected?.[sub] ?? {})));
  const findMany = vi.fn(async () => opts.users ?? []);
  const directory = new FixerTenantDirectory(
    { user: { findMany } } as never,
    { platformRolesFor } as never,
    { catalogs: opts.catalogs ?? ['rocket-autopecas'] } as never,
    opts.now,
  );
  return { directory, platformRolesFor, findMany };
}

describe('FixerTenantDirectory.membershipsOf', () => {
  it('sem participação em nenhuma organização: vazio, e nem consulta usuários', async () => {
    const { directory, findMany } = build();
    expect(await directory.membershipsOf('ninguem')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('devolve, em CADA organização, os papéis de plataforma que o control plane projetou (o Fixer não os recalcula)', async () => {
    const { directory } = build({
      projected: { u1: { [A]: ['price_manager', 'fiscal_editor'], [B]: ['viewer'] } },
      users: [
        { orgId: A, active: true },
        { orgId: B, active: true },
      ],
    });
    expect(await directory.membershipsOf('u1')).toEqual([
      { orgId: A, roles: ['price_manager', 'fiscal_editor'] },
      { orgId: B, roles: ['viewer'] },
    ]);
  });

  it('participa mas ainda não tem usuário no Fixer (convidado que não entrou): vale o que o control plane projetou', async () => {
    const { directory } = build({ projected: { u1: { [A]: ['viewer'] } }, users: [] });
    expect(await directory.membershipsOf('u1')).toEqual([{ orgId: A, roles: ['viewer'] }]);
  });

  it('vínculo ainda não projetado (lista vazia) fecha por padrão: nenhum papel', async () => {
    const { directory } = build({ projected: { u1: { [A]: [] } }, users: [{ orgId: A, active: true }] });
    expect(await directory.membershipsOf('u1')).toEqual([{ orgId: A, roles: [] }]);
  });

  it('usuário desativado na oficina mantém a participação mas sem papel algum, mesmo com papéis projetados', async () => {
    const { directory } = build({ projected: { u1: { [A]: ['price_manager'] } }, users: [{ orgId: A, active: false }] });
    expect(await directory.membershipsOf('u1')).toEqual([{ orgId: A, roles: [] }]);
  });

  it('desativado em uma organização não afeta a outra', async () => {
    const { directory } = build({
      projected: { u1: { [A]: ['price_manager'], [B]: ['viewer'] } },
      users: [
        { orgId: A, active: false },
        { orgId: B, active: true },
      ],
    });
    expect(await directory.membershipsOf('u1')).toEqual([
      { orgId: A, roles: [] },
      { orgId: B, roles: ['viewer'] },
    ]);
  });

  it('consulta o estado ativo só nas organizações do usuário', async () => {
    const { directory, findMany } = build({ projected: { u1: { [A]: ['viewer'] } }, users: [{ orgId: A.toUpperCase(), active: true }] });
    expect((await directory.membershipsOf('u1'))[0]?.orgId).toBe(A);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { keycloakId: 'u1', orgId: { in: [A] } } }));
  });

  it('cache curto por usuário: a segunda chamada não vai ao banco; passado o TTL, vai', async () => {
    let t = 0;
    const { directory, platformRolesFor } = build({ projected: { u1: { [A]: ['viewer'] } }, users: [{ orgId: A, active: true }], now: () => t });
    await directory.membershipsOf('u1');
    await directory.membershipsOf('u1');
    expect(platformRolesFor).toHaveBeenCalledTimes(1);
    t += 31_000;
    await directory.membershipsOf('u1');
    expect(platformRolesFor).toHaveBeenCalledTimes(2);
  });

  it('falha do banco propaga (o pacote responde 503; nunca concede por engano)', async () => {
    const directory = new FixerTenantDirectory(
      { user: { findMany: vi.fn() } } as never,
      { platformRolesFor: vi.fn().mockRejectedValue(new Error('db down')) } as never,
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
