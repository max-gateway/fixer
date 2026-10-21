import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MeController } from './me.controller.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type Profile = { orgId: string; slug: string | null; name: string | null };

function build(payload: object | Error, member: Record<string, string[]> = {}, profiles: Profile[] = []) {
  const verify = vi.fn(async () => {
    if (payload instanceof Error) throw payload;
    return payload;
  });
  const findMany = vi.fn(async ({ where }: { where: { orgId: { in: string[] } } }) => profiles.filter((p) => where.orgId.in.includes(p.orgId)));
  const membership = { membershipsOf: async (sub: string) => (member[sub] ?? []).map((orgId) => ({ orgId, roles: ['member'] })) };
  const controller = new MeController({ verify } as never, { orgProfile: { findMany } } as never, membership as never);
  return { controller, verify, findMany };
}

describe('GET /me/organizations', () => {
  it('lista as oficinas do registro de participação do usuário, com o nome de cada uma', async () => {
    const { controller } = build({ sub: 'u1' }, { u1: [A, B] }, [
      { orgId: A, slug: 'a', name: 'Alfa' },
      { orgId: B, slug: 'b', name: 'Beta' },
    ]);
    expect((await controller.organizations('Bearer t')).organizations.map((o) => o.name).sort()).toEqual(['Alfa', 'Beta']);
  });

  it('só devolve organizações DO USUÁRIO: nunca consulta nem expõe as de outro', async () => {
    const { controller, findMany } = build({ sub: 'u1' }, { u1: [A], u2: [C] }, [
      { orgId: A, slug: 'a', name: 'A' },
      { orgId: C, slug: 'c', name: 'Segredo de outra oficina' },
    ]);
    const out = await controller.organizations('Bearer tok');
    expect(out.organizations.map((o) => o.id)).toEqual([A]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: { in: [A] } } }));
    expect(JSON.stringify(out)).not.toContain('Segredo');
  });

  it('o claim `organization` do token NUNCA concede: sem participação a lista é vazia (e nada é consultado)', async () => {
    const { controller, findMany } = build({ sub: 'u1', organization: [A] });
    expect((await controller.organizations('Bearer tok')).organizations).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('sem token, token malformado ou inválido → 401 (e nada é consultado)', async () => {
    const ok = build({ sub: 'u1' }, { u1: [A] });
    await expect(ok.controller.organizations(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ok.controller.organizations('Basic xyz')).rejects.toBeInstanceOf(UnauthorizedException);
    const bad = build(new UnauthorizedException('Token inválido'));
    await expect(bad.controller.organizations('Bearer lixo')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ok.findMany).not.toHaveBeenCalled();
    expect(bad.findMany).not.toHaveBeenCalled();
  });
});
