import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MeController } from './me.controller.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function build(payload: object | Error, profiles: { orgId: string; slug: string | null; name: string | null }[] = [], cfg: { orgsClaim?: string; defaultOrgId?: string } = {}) {
  const verify = vi.fn(async () => {
    if (payload instanceof Error) throw payload;
    return payload;
  });
  const findMany = vi.fn(async ({ where }: { where: { orgId: { in: string[] } } }) => profiles.filter((p) => where.orgId.in.includes(p.orgId)));
  const controller = new MeController({ verify } as never, { orgsClaim: 'organization', ...cfg } as never, { orgProfile: { findMany } } as never);
  return { controller, verify, findMany };
}

describe('GET /me/organizations com participação conhecida', () => {
  it('soma o claim e a participação: token sem claim ainda lista as oficinas do usuário', async () => {
    const profiles = [
      { orgId: A, slug: 'a', name: 'Alfa' },
      { orgId: B, slug: 'b', name: 'Beta' },
    ];
    const findMany = vi.fn(async ({ where }: { where: { orgId: { in: string[] } } }) => profiles.filter((p) => where.orgId.in.includes(p.orgId)));
    const membership = { orgsFor: async (sub: string) => (sub === 'u1' ? [A, B] : []) };
    const controller = new MeController({ verify: async () => ({ sub: 'u1' }) } as never, { orgsClaim: 'organization' } as never, { orgProfile: { findMany } } as never, membership as never);
    expect((await controller.organizations('Bearer t')).organizations.map((o) => o.name).sort()).toEqual(['Alfa', 'Beta']);
  });
});

describe('GET /me/organizations', () => {
  it('lista as organizações do token com o nome de cada uma', async () => {
    const { controller } = build({ organization: [A, B] }, [
      { orgId: A, slug: 'alfa-1a2b3c', name: 'Oficina Alfa Ltda' },
      { orgId: B, slug: 'beta-4d5e6f', name: null },
    ]);
    expect(await controller.organizations('Bearer tok')).toEqual({
      organizations: [
        { id: A, name: 'Oficina Alfa Ltda', slug: 'alfa-1a2b3c' },
        { id: B, name: 'beta-4d5e6f', slug: 'beta-4d5e6f' }, // sem nome: cai para o slug
      ],
    });
  });

  it('organização ainda não provisionada no Fixer vem sem nome (o front mostra o id)', async () => {
    const { controller } = build({ organization: [A] });
    expect((await controller.organizations('Bearer tok')).organizations).toEqual([{ id: A, name: null, slug: null }]);
  });

  it('só devolve organizações DO TOKEN: nunca consulta nem expõe as de outro', async () => {
    const { controller, findMany } = build({ organization: [A] }, [
      { orgId: A, slug: 'a', name: 'A' },
      { orgId: C, slug: 'c', name: 'Segredo de outra oficina' },
    ]);
    const out = await controller.organizations('Bearer tok');
    expect(out.organizations.map((o) => o.id)).toEqual([A]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: { in: [A] } } }));
    expect(JSON.stringify(out)).not.toContain('Segredo');
  });

  it('lê o claim configurado e ignora lixo', async () => {
    const { controller } = build({ orgs_custom: [B, 'nao-uuid', 7] }, [], { orgsClaim: 'orgs_custom' });
    expect((await controller.organizations('Bearer tok')).organizations.map((o) => o.id)).toEqual([B]);
  });

  it('token sem claim: vazio; instalação legada: a organização padrão', async () => {
    expect((await build({}).controller.organizations('Bearer tok')).organizations).toEqual([]);
    const legacy = build({}, [{ orgId: A, slug: 'legado', name: 'Oficina Legada' }], { defaultOrgId: A.toUpperCase() });
    expect((await legacy.controller.organizations('Bearer tok')).organizations).toEqual([{ id: A, name: 'Oficina Legada', slug: 'legado' }]);
    expect(legacy.findMany).toHaveBeenCalledOnce();
  });

  it('sem token, token malformado ou inválido → 401 (e nada é consultado)', async () => {
    const ok = build({ organization: [A] });
    await expect(ok.controller.organizations(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ok.controller.organizations('Basic xyz')).rejects.toBeInstanceOf(UnauthorizedException);
    const bad = build(new UnauthorizedException('Token inválido'));
    await expect(bad.controller.organizations('Bearer lixo')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ok.findMany).not.toHaveBeenCalled();
    expect(bad.findMany).not.toHaveBeenCalled();
  });
});
