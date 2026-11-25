import type { PrismaClient } from '@fixer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { systemClient, tenantClient } from '../../test/db.js';
import { OTHER_ORG, TEST_ORG } from '../../test/setup.js';
import { MembershipService } from '../tenancy/membership.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { ControlPlaneEventsConsumer, type ControlPlaneEvent } from './control-plane-events.consumer.js';
import type { ControlPlaneConfig } from './control-plane.config.js';
import { PendingInviteService } from './pending-invite.service.js';

/**
 * Convite que aguarda a identidade no control plane, contra Postgres REAL e com RLS (papel `fixer_rls`). Só roda com FISCAL_TEST_DATABASE_URL.
 * O control plane cria a conta de forma assíncrona; o Fixer guarda só os papéis da oficina e os aplica quando `identity.member_ready` chega.
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const A = TEST_ORG;
const B = OTHER_ORG;
const actor = { id: 'u-admin', name: 'Ana Admin' } as never;

describe.skipIf(!URL)('Convite pendente (Postgres, RLS)', () => {
  let db: PrismaClient;
  let sys: PrismaClient;
  let release: () => Promise<void>;
  let invites: PendingInviteService;

  const inOrg = <T>(org: string, fn: () => Promise<T>) => TenantContext.run(org, fn);
  const wipe = async () => {
    for (const org of [A, B]) {
      await inOrg(org, async () => {
        await db.accessAuditLog.deleteMany();
        await db.pendingInvite.deleteMany();
        await db.userRole.deleteMany();
        await db.user.deleteMany();
        await db.role.deleteMany();
        await db.orgMembership.deleteMany();
      });
    }
  };
  const role = (org: string, name: string) => inOrg(org, () => db.role.create({ data: { name } }));
  const readyEvent = (org: string, sub: string, email: string): ControlPlaneEvent => ({
    id: `e-${sub}`,
    type: 'identity.member_ready.v1',
    tenantId: org,
    data: { keycloakSub: sub, email, role: 'member', userId: 'cp-u', platformRoles: ['viewer'] },
  });
  const consumer = () =>
    new ControlPlaneEventsConsumer({ product: 'fixer', enabled: false } as unknown as ControlPlaneConfig, {} as never, {} as never, new MembershipService(db as never, sys as never), invites);

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    db = tenantClient(URL!);
    sys = systemClient(URL!);
    invites = new PendingInviteService(db as never);
    await wipe();
  }, 60_000);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
    await sys.$disconnect();
    await release();
  }, 60_000);
  beforeEach(wipe);

  it('registrar o mesmo e-mail de novo não duplica: atualiza nome e papéis, e o e-mail é normalizado', async () => {
    const [r1, r2] = [await role(A, 'Balcão'), await role(A, 'Estoque')];
    await inOrg(A, () => invites.upsert({ email: ' Novo@Oficina.com ', name: 'Novo', roleIds: [r1.id], invitedById: 'u1' }));
    await inOrg(A, () => invites.upsert({ email: 'novo@oficina.com', name: 'Novo Nome', roleIds: [r1.id, r2.id, r2.id], invitedById: 'u1' }));
    const all = await inOrg(A, () => invites.list());
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ email: 'novo@oficina.com', name: 'Novo Nome' });
    expect([...all[0]!.roleIds].sort()).toEqual([r1.id, r2.id].sort());
  });

  it('identidade pronta: cria o usuário do Fixer com os papéis do convite, apaga o convite e audita', async () => {
    const r1 = await role(A, 'Balcão');
    await inOrg(A, () => invites.upsert({ email: 'novo@oficina.com', name: 'Novo', roleIds: [r1.id], invitedById: 'u1' }));

    expect(await inOrg(A, () => invites.claim({ keycloakId: 'sub-novo', email: 'Novo@Oficina.com' }))).toBe(true);

    const user = await inOrg(A, () => db.user.findFirst({ where: { keycloakId: 'sub-novo' }, include: { roles: true } }));
    expect(user).toMatchObject({ email: 'novo@oficina.com', name: 'Novo', active: true });
    expect(user?.roles.map((r) => r.roleId)).toEqual([r1.id]);
    expect(await inOrg(A, () => invites.list())).toEqual([]);
    const audit = await inOrg(A, () => db.accessAuditLog.findMany({ where: { action: 'member.invite_accepted' } }));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: null, targetId: 'sub-novo', targetLabel: 'novo@oficina.com' });
  });

  it('é idempotente: o evento chega pelo menos uma vez, e o segundo não mexe em nada', async () => {
    const r1 = await role(A, 'Balcão');
    await inOrg(A, () => invites.upsert({ email: 'novo@oficina.com', roleIds: [r1.id], invitedById: null }));
    await inOrg(A, () => invites.claim({ keycloakId: 'sub-novo', email: 'novo@oficina.com' }));
    expect(await inOrg(A, () => invites.claim({ keycloakId: 'sub-novo', email: 'novo@oficina.com' }))).toBe(false);
    expect(await inOrg(A, () => db.user.count())).toBe(1);
    expect(await inOrg(A, () => db.userRole.count())).toBe(1);
  });

  it('papel apagado entre o convite e a identidade não concede nada; os demais valem', async () => {
    const [keep, gone] = [await role(A, 'Balcão'), await role(A, 'Efêmero')];
    await inOrg(A, () => invites.upsert({ email: 'novo@oficina.com', roleIds: [keep.id, gone.id], invitedById: null }));
    await inOrg(A, () => db.role.delete({ where: { id: gone.id } }));
    await inOrg(A, () => invites.claim({ keycloakId: 'sub-novo', email: 'novo@oficina.com' }));
    const user = await inOrg(A, () => db.user.findFirst({ where: { keycloakId: 'sub-novo' }, include: { roles: true } }));
    expect(user?.roles.map((r) => r.roleId)).toEqual([keep.id]);
  });

  it('quem já tinha usuário desativado com esse e-mail é reativado, com o sub do control plane e os papéis do convite', async () => {
    const [old, novo] = [await role(A, 'Antigo'), await role(A, 'Novo papel')];
    const prior = await inOrg(A, () => db.user.create({ data: { keycloakId: 'sub-velho', email: 'volta@oficina.com', name: 'Volta', active: false, roles: { create: [{ roleId: old.id }] } } }));
    await inOrg(A, () => invites.upsert({ email: 'volta@oficina.com', roleIds: [novo.id], invitedById: null }));
    await inOrg(A, () => invites.claim({ keycloakId: 'sub-novo', email: 'volta@oficina.com' }));
    const user = await inOrg(A, () => db.user.findUniqueOrThrow({ where: { id: prior.id }, include: { roles: true } }));
    expect(user).toMatchObject({ keycloakId: 'sub-novo', active: true });
    expect(user.roles.map((r) => r.roleId)).toEqual([novo.id]); // o papel antigo não volta sozinho
  });

  it('isolamento: o convite de uma oficina não é aplicado nem visto por outra com o mesmo e-mail', async () => {
    const r1 = await role(A, 'Balcão');
    await role(B, 'Balcão');
    await inOrg(A, () => invites.upsert({ email: 'mesma@pessoa.com', roleIds: [r1.id], invitedById: null }));
    expect(await inOrg(B, () => invites.list())).toEqual([]);
    expect(await inOrg(B, () => invites.claim({ keycloakId: 'sub-b', email: 'mesma@pessoa.com' }))).toBe(false);
    expect(await inOrg(B, () => db.user.count())).toBe(0);
    expect(await inOrg(A, () => invites.list())).toHaveLength(1); // o de A continua esperando
  });

  it('cancelar apaga só a intenção, audita, e cancelar de novo (ou id de outra oficina) não faz nada', async () => {
    const r1 = await role(A, 'Balcão');
    const inv = await inOrg(A, () => invites.upsert({ email: 'novo@oficina.com', roleIds: [r1.id], invitedById: null }));
    expect(await inOrg(B, () => invites.cancel(inv.id, actor))).toEqual({ id: inv.id, cancelled: false });
    expect(await inOrg(A, () => invites.cancel(inv.id, actor))).toEqual({ id: inv.id, cancelled: true });
    expect(await inOrg(A, () => invites.cancel(inv.id, actor))).toEqual({ id: inv.id, cancelled: false });
    expect(await inOrg(A, () => db.accessAuditLog.count({ where: { action: 'member.invite_cancelled' } }))).toBe(1);
  });

  it('pelo consumidor: identity.member_ready cria o vínculo, projeta os papéis de plataforma e aplica o convite', async () => {
    const r1 = await role(A, 'Balcão');
    await inOrg(A, () => invites.upsert({ email: 'novo@oficina.com', name: 'Novo', roleIds: [r1.id], invitedById: null }));

    expect(await consumer().handle(readyEvent(A, 'sub-novo', 'novo@oficina.com'))).toBe('member');

    expect(await inOrg(A, () => db.orgMembership.findFirst({ where: { keycloakId: 'sub-novo' } }))).toMatchObject({ source: 'control_plane', platformRoles: ['viewer'] });
    expect((await inOrg(A, () => db.user.findFirst({ where: { keycloakId: 'sub-novo' }, include: { roles: true } })))?.roles.map((r) => r.roleId)).toEqual([r1.id]);
    expect(await inOrg(A, () => invites.list())).toEqual([]);
  });

  it('pelo consumidor: pessoa sem convite só entra na organização, sem virar usuário do Fixer', async () => {
    expect(await consumer().handle(readyEvent(A, 'sub-solta', 'solta@oficina.com'))).toBe('member');
    expect(await inOrg(A, () => db.orgMembership.count())).toBe(1);
    expect(await inOrg(A, () => db.user.count())).toBe(0);
  });
});
