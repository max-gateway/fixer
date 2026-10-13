import type { PrismaClient } from '@fixer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../auth/permissions.catalog.js';
import { systemClient, tenantClient } from '../../test/db.js';
import { MembershipService } from '../tenancy/membership.service.js';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { OTHER_ORG, TEST_ORG } from '../../test/setup.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { ControlPlaneEventsConsumer, type ControlPlaneEvent } from './control-plane-events.consumer.js';
import type { ControlPlaneConfig } from './control-plane.config.js';
import type { LicenseClaims } from './control-plane.client.js';
import { LicenseService } from './license.service.js';
import { ProvisioningService } from './provisioning.service.js';

/**
 * Provisionamento e licença por evento do control plane, contra Postgres REAL e com RLS (papel `fixer_rls`).
 * Só roda com FISCAL_TEST_DATABASE_URL (banco descartável, já migrado).
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const A = TEST_ORG;
const B = OTHER_ORG;

describe.skipIf(!URL)('Integração com o control plane (Postgres, RLS)', () => {
  let db: PrismaClient;
  let sys: PrismaClient;
  let release: () => Promise<void>;
  let snapshots: Record<string, LicenseClaims | null | Error>;
  let licenseRequired = false;

  const claims = (org: string, over: Partial<LicenseClaims> = {}): LicenseClaims => ({
    sub: org, product: 'fixer', status: 'trialing', mode: 'full', ver: 1, trialEndsAt: null, readonlyUntil: null, ent: { users: { kind: 'limit', value: 5 } }, exp: 0, ...over,
  });
  const cfg = () => ({ product: 'fixer', licenseRequired, enabled: false }) as unknown as ControlPlaneConfig;
  const client = { snapshot: async (org: string) => { const s = snapshots[org]; if (s instanceof Error) throw s; return s ?? null; } };
  const services = () => {
    const provisioning = new ProvisioningService(db as never);
    const license = new LicenseService(db as never, client as never, cfg());
    const membership = new MembershipService(db as never, sys as never);
    return { provisioning, license, membership, consumer: new ControlPlaneEventsConsumer(cfg(), provisioning, license, membership) };
  };
  const evt = (org: string, type: string, data: Record<string, unknown> = {}, id = String(Math.random())): ControlPlaneEvent => ({ id, type, tenantId: org, data });
  const inOrg = <T>(org: string, fn: () => Promise<T>) => TenantContext.run(org, fn);

  const wipe = async () => {
    for (const org of [A, B]) {
      await inOrg(org, async () => {
        await db.orgMembership.deleteMany();
        await db.userRole.deleteMany();
        await db.rolePermission.deleteMany();
        await db.role.deleteMany();
        await db.user.deleteMany();
        await db.orgLicense.deleteMany();
        await db.orgProfile.deleteMany();
      });
    }
  };

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    db = tenantClient(URL!);
    sys = systemClient(URL!);
    await wipe();
  }, 60_000);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
    await sys.$disconnect();
    await release();
  }, 60_000);
  beforeEach(async () => {
    await wipe();
    snapshots = {};
    licenseRequired = false;
  });

  describe('provisionamento', () => {
    it('organization.created grava o perfil e cria o papel Admin com TODAS as permissões', async () => {
      const { consumer } = services();
      expect(await consumer.handle(evt(A, 'organization.created.v1', { slug: 'oficina-a', legalName: 'Oficina A Ltda', ownerEmail: 'Dono@Oficina.test' }))).toBe('provisioned');
      const { profile, role, perms } = await inOrg(A, async () => ({
        profile: await db.orgProfile.findUnique({ where: { orgId: A } }),
        role: await db.role.findFirst({ where: { name: 'Admin' }, include: { permissions: true } }),
        perms: await db.permission.count({ where: { key: { in: PERMISSIONS.map((p) => p.key) } } }),
      }));
      expect(profile).toMatchObject({ slug: 'oficina-a', name: 'Oficina A Ltda', ownerEmail: 'dono@oficina.test' });
      expect(role).toMatchObject({ isSystem: true });
      expect(role!.permissions).toHaveLength(PERMISSIONS.length);
      expect(perms).toBe(PERMISSIONS.length);
    });

    it('é idempotente: repetir não duplica papel, permissão nem vínculo', async () => {
      const { consumer } = services();
      for (let i = 0; i < 3; i++) await consumer.handle(evt(A, 'organization.created.v1', { slug: 'a', ownerEmail: 'a@x.test' }));
      const n = await inOrg(A, async () => ({ roles: await db.role.count(), links: await db.rolePermission.count() }));
      expect(n).toEqual({ roles: 1, links: PERMISSIONS.length });
    });

    it('eventos SIMULTÂNEOS (da mesma e de várias organizações) não colidem nem duplicam', async () => {
      const { consumer } = services();
      snapshots[A] = claims(A);
      snapshots[B] = claims(B);
      const burst = [A, B].flatMap((org) =>
        Array.from({ length: 6 }, (_, i) => consumer.handle(evt(org, i % 2 ? 'organization.created.v1' : 'subscription.trial_started.v1', { product: 'fixer', slug: `s-${org.slice(0, 2)}`, ownerEmail: `o@${org.slice(0, 2)}.test` }))),
      );
      await expect(Promise.all(burst)).resolves.toHaveLength(12);
      for (const org of [A, B]) {
        const n = await inOrg(org, async () => ({ roles: await db.role.count(), links: await db.rolePermission.count() }));
        expect(n).toEqual({ roles: 1, links: PERMISSIONS.length });
      }
      expect(await db.permission.count({ where: { key: { in: PERMISSIONS.map((p) => p.key) } } })).toBe(PERMISSIONS.length);
    });

    it('cada organização tem o seu Admin, sem ver o da outra', async () => {
      const { consumer } = services();
      await consumer.handle(evt(A, 'organization.created.v1', { ownerEmail: 'a@x.test' }));
      await consumer.handle(evt(B, 'organization.created.v1', { ownerEmail: 'b@x.test' }));
      expect(await inOrg(A, () => db.role.count())).toBe(1);
      expect(await inOrg(B, () => db.role.count())).toBe(1);
      expect((await inOrg(A, () => db.orgProfile.findMany())).map((p) => p.ownerEmail)).toEqual(['a@x.test']);
    });

    it('o início do trial do nosso produto garante os papéis mesmo se organization.created ainda não chegou', async () => {
      const { consumer } = services();
      snapshots[A] = claims(A);
      expect(await consumer.handle(evt(A, 'subscription.trial_started.v1', { product: 'fixer' }))).toBe('refreshed');
      expect(await inOrg(A, () => db.role.count())).toBe(1);
      expect(await inOrg(A, () => db.orgLicense.findUnique({ where: { orgId: A } }))).toMatchObject({ mode: 'full', status: 'trialing', version: 1 });
    });

    it('eventos de outro produto são ignorados', async () => {
      const { consumer } = services();
      snapshots[A] = claims(A);
      expect(await consumer.handle(evt(A, 'subscription.activated.v1', { product: 'rocket' }))).toBe('ignored');
      expect(await consumer.handle(evt(A, 'invoice.paid.v1', { product: 'fixer' }))).toBe('ignored');
      expect(await inOrg(A, () => db.orgLicense.count())).toBe(0);
    });
  });

  describe('participação (identity.member_ready)', () => {
    const ready = (org: string, sub: string, email: string, role = 'member') => evt(org, 'identity.member_ready.v1', { keycloakSub: sub, email, role, userId: 'u' });

    it('registra quem participa da oficina; repetir não duplica e atualiza o papel', async () => {
      const { consumer, membership } = services();
      expect(await consumer.handle(ready(A, 'sub-1', 'Ana@X.test', 'owner'))).toBe('member');
      await consumer.handle(ready(A, 'sub-1', 'ana@x.test', 'admin'));
      const rows = await inOrg(A, () => db.orgMembership.findMany());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ keycloakId: 'sub-1', email: 'ana@x.test', role: 'admin' });
      expect(await inOrg(A, () => membership.isMember('sub-1'))).toBe(true);
    });

    it('uma pessoa em DUAS oficinas é achada nas duas pelo sub, e cada oficina só vê as suas linhas', async () => {
      const { consumer, membership } = services();
      await consumer.handle(ready(A, 'sub-ana', 'ana@x.test'));
      await consumer.handle(ready(B, 'sub-ana', 'ana@x.test'));
      await consumer.handle(ready(B, 'sub-bia', 'bia@x.test'));
      expect((await membership.orgsFor('sub-ana')).sort()).toEqual([A, B].sort());
      expect(await membership.orgsFor('sub-bia')).toEqual([B]);
      expect(await membership.orgsFor('sub-ninguem')).toEqual([]);
      expect(await inOrg(A, () => db.orgMembership.count())).toBe(1); // RLS: A não enxerga a Bia
      expect(await inOrg(B, () => db.orgMembership.count())).toBe(2);
    });

    it('a organização nova aparece na hora (o cache é invalidado ao registrar)', async () => {
      const { consumer, membership } = services();
      await consumer.handle(ready(A, 'sub-c', 'c@x.test'));
      expect(await membership.orgsFor('sub-c')).toEqual([A]);
      await consumer.handle(ready(B, 'sub-c', 'c@x.test'));
      expect((await membership.orgsFor('sub-c')).sort()).toEqual([A, B].sort());
    });

    it('evento sem sub ou e-mail é ignorado; remover tira a participação', async () => {
      const { consumer, membership } = services();
      expect(await consumer.handle(evt(A, 'identity.member_ready.v1', { email: 'x@x.test' }))).toBe('ignored');
      expect(await consumer.handle(evt(A, 'identity.member_ready.v1', { keycloakSub: 's' }))).toBe('ignored');
      await consumer.handle(ready(A, 'sub-d', 'd@x.test'));
      await inOrg(A, () => membership.remove('sub-d'));
      expect(await membership.orgsFor('sub-d')).toEqual([]);
    });

    it('eventos simultâneos do mesmo membro não colidem', async () => {
      const { consumer } = services();
      await Promise.all(Array.from({ length: 8 }, (_, i) => consumer.handle(ready(A, 'sub-e', 'e@x.test', i % 2 ? 'admin' : 'member'))));
      expect(await inOrg(A, () => db.orgMembership.count())).toBe(1);
    });
  });

  describe('dono vira Admin no primeiro login', () => {
    const login = (org: string, email: string, name = 'U') =>
      inOrg(org, () => db.user.create({ data: { keycloakId: `kc-${email}`, email, name } }));

    it('só o e-mail do dono ganha Admin (sem distinguir maiúsculas), uma vez', async () => {
      const { consumer, provisioning } = services();
      await consumer.handle(evt(A, 'organization.created.v1', { ownerEmail: 'dono@x.test' }));
      const owner = await login(A, 'DONO@x.test');
      const other = await login(A, 'func@x.test');
      expect(await inOrg(A, () => provisioning.ensureOwnerAdmin(owner))).toBe(true);
      expect(await inOrg(A, () => provisioning.ensureOwnerAdmin(owner))).toBe(false); // já tem papel
      expect(await inOrg(A, () => provisioning.ensureOwnerAdmin(other))).toBe(false);
      expect(await inOrg(A, () => db.userRole.count({ where: { userId: owner.id } }))).toBe(1);
      expect(await inOrg(A, () => db.userRole.count({ where: { userId: other.id } }))).toBe(0);
    });

    it('o mesmo e-mail em OUTRA organização não herda nada', async () => {
      const { consumer, provisioning } = services();
      await consumer.handle(evt(A, 'organization.created.v1', { ownerEmail: 'dono@x.test' }));
      await consumer.handle(evt(B, 'organization.created.v1', { ownerEmail: 'outro@x.test' }));
      const sameEmailInB = await login(B, 'dono@x.test');
      expect(await inOrg(B, () => provisioning.ensureOwnerAdmin(sameEmailInB))).toBe(false);
    });

    it('o dono ganha Admin mesmo quando o login vem antes do evento de trial', async () => {
      const { consumer, provisioning } = services();
      await consumer.handle(evt(A, 'organization.created.v1', { ownerEmail: 'dono@x.test' })); // já cria o papel
      const owner = await login(A, 'dono@x.test');
      expect(await inOrg(A, () => provisioning.ensureOwnerAdmin(owner))).toBe(true);
    });
  });

  describe('licença', () => {
    it('sem licença gravada: acesso livre (instalação legada); com LICENSE_REQUIRED: bloqueado', async () => {
      const { license } = services();
      expect(await inOrg(A, () => license.mode())).toBe('full');
      licenseRequired = true;
      const strict = services().license; // a configuração é lida na criação
      expect(await inOrg(B, () => strict.mode())).toBe('none');
    });

    it('os eventos do produto atualizam o modo; suspensão vira somente leitura', async () => {
      const { consumer, license } = services();
      snapshots[A] = claims(A, { status: 'active', ver: 2 });
      await consumer.handle(evt(A, 'subscription.activated.v1', { product: 'fixer' }));
      expect(await inOrg(A, () => license.mode())).toBe('full');
      snapshots[A] = claims(A, { status: 'suspended', mode: 'readonly', ver: 3 });
      await consumer.handle(evt(A, 'subscription.suspended.v1', { product: 'fixer' }));
      expect(await inOrg(A, () => license.mode(new Date(Date.now() + 60_000)))).toBe('readonly'); // fora do cache de 30 s
    });

    it('um snapshot mais antigo nunca sobrescreve um mais novo', async () => {
      const { consumer } = services();
      snapshots[A] = claims(A, { status: 'suspended', mode: 'readonly', ver: 5 });
      await consumer.handle(evt(A, 'subscription.suspended.v1', { product: 'fixer' }));
      snapshots[A] = claims(A, { status: 'active', mode: 'full', ver: 4 }); // chegou atrasado
      await consumer.handle(evt(A, 'subscription.activated.v1', { product: 'fixer' }));
      expect(await inOrg(A, () => db.orgLicense.findUnique({ where: { orgId: A } }))).toMatchObject({ mode: 'readonly', version: 5 });
    });

    it('somente leitura cuja janela terminou vira sem acesso, mesmo sem novo evento', async () => {
      const { consumer, license } = services();
      snapshots[A] = claims(A, { status: 'expired', mode: 'readonly', ver: 2, readonlyUntil: new Date(Date.now() + 3_600_000).toISOString() });
      await consumer.handle(evt(A, 'subscription.expired.v1', { product: 'fixer' }));
      expect(await inOrg(A, () => license.mode())).toBe('readonly');
      expect(await inOrg(A, () => license.mode(new Date(Date.now() + 2 * 3_600_000)))).toBe('none');
    });

    it('as licenças de organizações diferentes não se misturam', async () => {
      const { consumer, license } = services();
      snapshots[A] = claims(A, { mode: 'full', ver: 1 });
      snapshots[B] = claims(B, { status: 'suspended', mode: 'readonly', ver: 1 });
      await consumer.handle(evt(A, 'subscription.trial_started.v1', { product: 'fixer' }));
      await consumer.handle(evt(B, 'subscription.suspended.v1', { product: 'fixer' }));
      expect(await inOrg(A, () => license.mode(new Date(Date.now() + 60_000)))).toBe('full');
      expect(await inOrg(B, () => license.mode(new Date(Date.now() + 60_000)))).toBe('readonly');
    });

    it('falha ao buscar o snapshot lança (o evento será reprocessado) e preserva a licença anterior', async () => {
      const { consumer } = services();
      snapshots[A] = claims(A, { mode: 'readonly', status: 'suspended', ver: 2 });
      await consumer.handle(evt(A, 'subscription.suspended.v1', { product: 'fixer' }));
      snapshots[A] = new Error('control plane fora do ar');
      await expect(consumer.handle(evt(A, 'entitlements.changed.v1', { product: 'fixer' }))).rejects.toThrow('fora do ar');
      expect(await inOrg(A, () => db.orgLicense.findUnique({ where: { orgId: A } }))).toMatchObject({ mode: 'readonly', version: 2 });
    });

    it('organização sem assinatura neste produto (null) perde a licença conhecida', async () => {
      const { consumer } = services();
      snapshots[A] = claims(A);
      await consumer.handle(evt(A, 'subscription.trial_started.v1', { product: 'fixer' }));
      snapshots[A] = null;
      await consumer.handle(evt(A, 'subscription.canceled.v1', { product: 'fixer' }));
      expect(await inOrg(A, () => db.orgLicense.count())).toBe(0);
    });
  });
});
