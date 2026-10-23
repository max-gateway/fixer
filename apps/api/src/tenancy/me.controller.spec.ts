import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MeController } from './me.controller.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Profile = { orgId: string; slug: string | null; name: string | null };

function build(payload: object | Error, memberOf: Record<string, string[]> = {}, profiles: Profile[] = []) {
  const verify = vi.fn(async () => {
    if (payload instanceof Error) throw payload;
    return payload;
  });
  const findMany = vi.fn(async ({ where }: { where: { orgId: { in: string[] } } }) => profiles.filter((p) => where.orgId.in.includes(p.orgId)));
  const membership = { orgsFor: vi.fn(async (sub: string) => memberOf[sub] ?? []) };
  const controller = new MeController({ verify } as never, { orgProfile: { findMany } } as never, membership as never);
  return { controller, findMany, membership };
}

describe('GET /me/organizations (só as organizações que o registro confirma)', () => {
  it('lista as oficinas do usuário com o nome de cada uma, e só elas', async () => {
    const { controller, findMany } = build({ sub: 'u1' }, { u1: [A] }, [
      { orgId: A, slug: 'a', name: 'Alfa' },
      { orgId: B, slug: 'b', name: 'Segredo' },
    ]);
    const out = await controller.organizations('Bearer tok');
    expect(out.organizations).toEqual([{ id: A, name: 'Alfa', slug: 'a' }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: { in: [A] } } }));
    expect(JSON.stringify(out)).not.toContain('Segredo');
  });

  it('várias oficinas: devolve todas', async () => {
    const { controller } = build({ sub: 'u1' }, { u1: [A, B] }, [
      { orgId: A, slug: 'a', name: 'Alfa' },
      { orgId: B, slug: 'b', name: 'Beta' },
    ]);
    expect((await controller.organizations('Bearer tok')).organizations.map((o) => o.name).sort()).toEqual(['Alfa', 'Beta']);
  });

  it('o claim do token não lista nada sozinho (ele nunca concede)', async () => {
    const { controller, findMany } = build({ sub: 'u1', organization: [A] }, {}, [{ orgId: A, slug: 'a', name: 'Alfa' }]);
    expect((await controller.organizations('Bearer tok')).organizations).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('sem nome nem slug no perfil: o nome fica nulo', async () => {
    const { controller } = build({ sub: 'u1' }, { u1: [A] }, []);
    expect((await controller.organizations('Bearer tok')).organizations).toEqual([{ id: A, name: null, slug: null }]);
  });

  it('sem token, token malformado ou inválido → 401 (e nada é consultado)', async () => {
    const ok = build({ sub: 'u1' }, { u1: [A] });
    await expect(ok.controller.organizations(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ok.controller.organizations('Basic xyz')).rejects.toBeInstanceOf(UnauthorizedException);
    const bad = build(new UnauthorizedException('Token inválido'));
    await expect(bad.controller.organizations('Bearer lixo')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ok.findMany).not.toHaveBeenCalled();
    expect(bad.findMany).not.toHaveBeenCalled();
    expect(ok.membership.orgsFor).not.toHaveBeenCalled();
  });
});
