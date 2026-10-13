import type { PrismaClient } from '@fixer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemClient, tenantClient } from '../../test/db.js';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { OTHER_ORG, TEST_ORG } from '../../test/setup.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import type { ControlPlaneClient } from './control-plane.client.js';
import type { ControlPlaneConfig } from './control-plane.config.js';
import { LicenseService } from './license.service.js';
import { monthStart, PlanLimits } from './plan-limits.service.js';
import { UsageReporter } from './usage-reporter.service.js';

/** Limites do plano e reporte de uso contra Postgres REAL com RLS. Só roda com FISCAL_TEST_DATABASE_URL. */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const A = TEST_ORG;
const B = OTHER_ORG;

describe('monthStart', () => {
  it('é o primeiro instante do mês em Brasília', () => {
    expect(monthStart(new Date('2026-10-15T12:00:00Z')).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(monthStart(new Date('2026-11-01T01:00:00Z')).toISOString()).toBe('2026-10-01T03:00:00.000Z'); // 31/10 22h em Brasília
    expect(monthStart(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });
});

describe.skipIf(!URL)('Limites do plano (Postgres, RLS)', () => {
  let db: PrismaClient;
  let sys: PrismaClient;
  let release: () => Promise<void>;
  const inOrg = <T>(org: string, fn: () => Promise<T>) => TenantContext.run(org, fn);
  const cfg = { licenseRequired: false } as ControlPlaneConfig;
  const build = () => {
    const license = new LicenseService(db as never, {} as never, cfg);
    return { license, limits: new PlanLimits(db as never, license) };
  };
  const setLicense = (org: string, entitlements: object | null, mode = 'full') =>
    inOrg(org, async () => {
      await db.orgLicense.deleteMany();
      if (entitlements) await db.orgLicense.create({ data: { status: 'active', mode, version: 1, entitlements } });
    });
  const user = (org: string, kc: string, active = true) =>
    inOrg(org, () => db.user.create({ data: { keycloakId: kc, email: `${kc}@x.test`, name: kc, active } }));
  const order = async (org: string, tag: string, createdAt: Date = new Date()) =>
    inOrg(org, async () => {
      const u = await db.user.upsert({ where: { orgId_keycloakId: { orgId: org, keycloakId: 'orderer' } }, create: { keycloakId: 'orderer', email: 'o@x.test', name: 'o' }, update: {} });
      const c = await db.customer.create({ data: { name: tag } });
      const v = await db.vehicle.create({ data: { plate: tag, brand: 'F', model: 'P' } });
      return db.serviceOrder.create({ data: { portalToken: `pt-${tag}-${Math.random()}`, linkCode: `lc-${tag}-${Math.random()}`, customerId: c.id, vehicleId: v.id, createdById: u.id, createdAt } });
    });

  const wipe = async () => {
    for (const org of [A, B]) {
      await inOrg(org, async () => {
        await db.serviceOrderStatusLog.deleteMany();
        await db.serviceOrder.deleteMany();
        await db.vehicle.deleteMany();
        await db.customer.deleteMany();
        await db.user.deleteMany();
        await db.orgLicense.deleteMany();
      });
    }
    await sys.orgCounter.deleteMany({ where: { orgId: { in: [A, B] } } });
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
  beforeEach(wipe);

  describe('usuários', () => {
    it('barra o usuário NOVO acima do limite, mas quem já existe sempre entra', async () => {
      const { limits } = build();
      await setLicense(A, { users: { kind: 'limit', value: 2 } });
      await user(A, 'u1');
      await user(A, 'u2');
      const err = await inOrg(A, () => limits.assertUserSlot('u3')).catch((e) => e);
      expect(err.getStatus()).toBe(402);
      expect(err.getResponse()).toMatchObject({ error: 'plan_limit_reached', limit: 'users', max: 2, used: 2 });
      await expect(inOrg(A, () => limits.assertUserSlot('u1'))).resolves.toBeUndefined();
    });

    it('usuário desativado libera a vaga', async () => {
      const { limits } = build();
      await setLicense(A, { users: { kind: 'limit', value: 1 } });
      await user(A, 'ex', false);
      await expect(inOrg(A, () => limits.assertUserSlot('novo'))).resolves.toBeUndefined();
    });

    it('-1, chave ausente e instalação sem licença não limitam', async () => {
      for (const ent of [{ users: { kind: 'limit', value: -1 } }, { fiscal: { kind: 'flag', value: true } }, null]) {
        await setLicense(A, ent);
        await user(A, `x${Math.random()}`);
        await user(A, `y${Math.random()}`);
        await expect(inOrg(A, () => build().limits.assertUserSlot('qualquer'))).resolves.toBeUndefined();
        await inOrg(A, () => db.user.deleteMany());
      }
    });

    it('o limite de uma organização não afeta a outra', async () => {
      const { limits } = build();
      await setLicense(A, { users: { kind: 'limit', value: 1 } });
      await user(A, 'a1');
      await user(B, 'b1');
      await user(B, 'b2');
      await expect(inOrg(A, () => limits.assertUserSlot('a2'))).rejects.toMatchObject({ status: 402 });
      await expect(inOrg(B, () => limits.assertUserSlot('b3'))).resolves.toBeUndefined();
    });
  });

  describe('ordens por mês', () => {
    it('conta só as do mês corrente e barra a que passa do limite', async () => {
      const { limits } = build();
      await setLicense(A, { service_orders_per_month: { kind: 'metered', value: 2 } });
      await order(A, 'MES-OLD', new Date(Date.now() - 40 * 86_400_000)); // mês passado: não conta
      await order(A, 'MES-1');
      await expect(inOrg(A, () => limits.assertOrderSlot())).resolves.toBeUndefined();
      await order(A, 'MES-2');
      const err = await inOrg(A, () => limits.assertOrderSlot()).catch((e) => e);
      expect(err.getStatus()).toBe(402);
      expect(err.getResponse()).toMatchObject({ error: 'plan_limit_reached', limit: 'service_orders_per_month', max: 2, used: 2 });
    });

    it('a contagem é por organização', async () => {
      const { limits } = build();
      await setLicense(A, { service_orders_per_month: { kind: 'metered', value: 1 } });
      await setLicense(B, { service_orders_per_month: { kind: 'metered', value: 1 } });
      await order(A, 'PA1');
      await expect(inOrg(A, () => limits.assertOrderSlot())).rejects.toMatchObject({ status: 402 });
      await expect(inOrg(B, () => limits.assertOrderSlot())).resolves.toBeUndefined();
    });
  });

  describe('funcionalidades', () => {
    it('só bloqueia o que o plano desliga explicitamente', async () => {
      const { limits } = build();
      await setLicense(A, { fiscal: { kind: 'flag', value: false } });
      await expect(inOrg(A, () => limits.assertFeature('fiscal'))).rejects.toMatchObject({ status: 402 });
      await expect(inOrg(A, () => limits.assertFeature('outra'))).resolves.toBeUndefined();
      await setLicense(B, { fiscal: { kind: 'flag', value: true } });
      await expect(inOrg(B, () => limits.assertFeature('fiscal'))).resolves.toBeUndefined();
    });
  });

  describe('UsageReporter', () => {
    const reporterWith = (client: Partial<ControlPlaneClient>) => {
      const { limits } = build();
      return new UsageReporter({ enabled: false } as ControlPlaneConfig, sys as unknown as SystemPrismaService, limits, client as ControlPlaneClient);
    };

    it('informa o consumo de cada organização COM licença, e só quando muda', async () => {
      await setLicense(A, { users: { kind: 'limit', value: 9 } });
      await user(A, 'r1');
      await user(A, 'r2');
      await order(A, 'RU1');
      const reportUsage = vi.fn(async (_org: string, _metric: string, _quantity: number) => true);
      const reporter = reporterWith({ reportUsage });
      // O reporte varre TODAS as organizações com licença no banco: o teste olha só as chamadas das dele (hermético).
      const mine = () => reportUsage.mock.calls.filter(([org]) => org === A || org === B);
      await reporter.runOnce();
      expect(mine()).toHaveLength(2);
      expect(reportUsage).toHaveBeenCalledWith(A, 'users', 3); // r1, r2 e o "orderer" criado pela ordem
      expect(reportUsage).toHaveBeenCalledWith(A, 'service_orders_per_month', 1);
      expect(mine().every(([org]) => org === A)).toBe(true); // B não tem licença: nada é informado

      await reporter.runOnce();
      expect(mine()).toHaveLength(2); // nada mudou: nada reenviado
      await order(A, 'RU2');
      await reporter.runOnce();
      expect(mine()).toHaveLength(3); // só a métrica que mudou
      expect(mine().at(-1)).toEqual([A, 'service_orders_per_month', 2]);
    });

    it('a falha de uma organização não impede as outras e é tentada de novo depois', async () => {
      await setLicense(A, { users: { kind: 'limit', value: 9 } });
      await setLicense(B, { users: { kind: 'limit', value: 9 } });
      let failA = true;
      const reportUsage = vi.fn(async (org: string, _metric: string, _quantity: number) => {
        if (org === A && failA) throw new Error('control plane fora do ar');
        return true;
      });
      const reporter = reporterWith({ reportUsage });
      await reporter.runOnce();
      expect(reportUsage.mock.calls.some(([org]) => org === B)).toBe(true);
      failA = false;
      reportUsage.mockClear();
      await reporter.runOnce();
      expect(reportUsage.mock.calls.some(([org]) => org === A)).toBe(true);
      expect(reportUsage.mock.calls.some(([org]) => org === B)).toBe(false); // B já tinha sido enviado
    });
  });
});
