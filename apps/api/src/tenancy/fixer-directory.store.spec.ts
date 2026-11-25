import type { PrismaClient } from '@fixer/db';
import { applySnapshot } from '@max-gateway/directory-sync';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemClient } from '../../test/db.js';
import { OTHER_ORG, TEST_ORG } from '../../test/setup.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { FixerDirectoryStore } from './fixer-directory.store.js';

/**
 * O sync do diretório contra Postgres REAL (cliente de sistema, como a API). Só roda com FISCAL_TEST_DATABASE_URL (banco descartável, já migrado,
 * ver README). Apaga o que cria, nas duas organizações de teste.
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const A = TEST_ORG;
const B = OTHER_ORG;

describe.skipIf(!URL)('FixerDirectoryStore (Postgres real)', () => {
  let sys: PrismaClient;
  let store: FixerDirectoryStore;

  const wipe = async () => {
    await sys.orgMembership.deleteMany({ where: { orgId: { in: [A, B] } } });
    await sys.orgProfile.deleteMany({ where: { orgId: { in: [A, B] } } });
  };
  const members = (orgId: string) => sys.orgMembership.findMany({ where: { orgId }, orderBy: { keycloakId: 'asc' }, select: { keycloakId: true, role: true, source: true, email: true } });
  const snap = (orgs: string[], ms: { orgId: string; keycloakSub: string; role: string; email?: string | null }[]) => ({
    orgs: orgs.map((orgId) => ({ orgId, legalName: `Oficina ${orgId.slice(0, 4)}` })),
    members: ms.map((m) => ({ ...m, email: m.email ?? null })),
  });

  beforeAll(async () => {
    sys = systemClient(URL!);
    store = new FixerDirectoryStore(sys as unknown as SystemPrismaService);
    await wipe();
  });
  afterAll(async () => {
    await wipe();
    await sys.$disconnect();
  });
  beforeEach(wipe);

  it('grava a razão social e os membros como control_plane (e-mail em minúsculas)', async () => {
    await applySnapshot(snap([A], [{ orgId: A, keycloakSub: 'u1', role: 'owner', email: 'Dono@X.com' }]), store);
    expect((await sys.orgProfile.findUnique({ where: { orgId: A } }))?.name).toBe(`Oficina ${A.slice(0, 4)}`);
    expect(await members(A)).toEqual([{ keycloakId: 'u1', role: 'owner', source: 'control_plane', email: 'dono@x.com' }]);
  });

  it('repetir não duplica; o nome da organização é atualizado sem apagar slug nem dono', async () => {
    await sys.orgProfile.create({ data: { orgId: A, slug: 'oficina-a', name: 'Antigo', ownerEmail: 'dono@x.com' } });
    const s = snap([A], [{ orgId: A, keycloakSub: 'u1', role: 'owner', email: 'a@x.com' }]);
    await applySnapshot(s, store);
    await applySnapshot(s, store);
    expect((await members(A)).length).toBe(1);
    expect(await sys.orgProfile.findUnique({ where: { orgId: A } })).toMatchObject({ slug: 'oficina-a', ownerEmail: 'dono@x.com', name: `Oficina ${A.slice(0, 4)}` });
  });

  it('o e-mail existente não é apagado quando o control plane não manda um', async () => {
    await sys.orgMembership.create({ data: { orgId: A, keycloakId: 'u1', email: 'antigo@x.com', role: 'member', source: 'local' } });
    await applySnapshot(snap([A], [{ orgId: A, keycloakSub: 'u1', role: 'admin', email: null }]), store);
    expect(await members(A)).toEqual([{ keycloakId: 'u1', role: 'admin', source: 'control_plane', email: 'antigo@x.com' }]);
  });

  it('quem sai do control plane perde o vínculo; o convidado local (tela de acessos) NUNCA é removido', async () => {
    await sys.orgMembership.createMany({
      data: [
        { orgId: A, keycloakId: 'u1', email: 'a@x.com', role: 'owner', source: 'control_plane' },
        { orgId: A, keycloakId: 'saiu', email: 'b@x.com', role: 'member', source: 'control_plane' },
        { orgId: A, keycloakId: 'convidado-local', email: 'c@x.com', role: 'member', source: 'local' },
      ],
    });
    const r = await applySnapshot(snap([A], [{ orgId: A, keycloakSub: 'u1', role: 'owner', email: 'a@x.com' }]), store);
    expect(r.removed).toBe(1);
    expect((await members(A)).map((m) => m.keycloakId)).toEqual(['convidado-local', 'u1']);
  });

  it('só remove dentro das organizações do snapshot; a ausente mantém os membros', async () => {
    await sys.orgProfile.create({ data: { orgId: B, name: 'B' } });
    await sys.orgMembership.create({ data: { orgId: B, keycloakId: 'uB', email: 'b@x.com', role: 'owner', source: 'control_plane' } });
    await applySnapshot(snap([A], [{ orgId: A, keycloakSub: 'uA', role: 'owner', email: 'a@x.com' }]), store);
    expect((await members(B)).length).toBe(1);
  });

  it('snapshot sem membros contra vínculos control_plane existentes aborta e não apaga nada', async () => {
    await sys.orgProfile.create({ data: { orgId: A, name: 'A' } });
    await sys.orgMembership.create({ data: { orgId: A, keycloakId: 'u1', email: 'a@x.com', role: 'owner', source: 'control_plane' } });
    await expect(applySnapshot(snap([A], []), store)).rejects.toThrow(/snapshot sem membros/);
    expect((await members(A)).length).toBe(1);
  });
});
