import type { PrismaClient } from '@fixer/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { systemClient, tenantClient } from '../../test/db.js';
import { OTHER_ORG, TEST_ORG } from '../../test/setup.js';
import { TenantContext, TenantContextMissing } from './tenant-context.js';
import { TenantDirectory } from './tenant-directory.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

/**
 * Isolamento entre organizações contra Postgres REAL, conectando como `fixer_rls` (o papel da API em produção, sujeito a RLS).
 * Só roda com FISCAL_TEST_DATABASE_URL (banco descartável, já migrado). Apaga o que cria, nas duas organizações de teste.
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const A = TEST_ORG;
const B = OTHER_ORG;

describe.skipIf(!URL)('Isolamento por organização (Postgres, RLS)', () => {
  let db: PrismaClient; // sujeito a RLS (como a API)
  let sys: PrismaClient; // ignora RLS (como o SystemPrismaService)
  let release: () => Promise<void>;
  const inOrg = <T>(org: string, fn: () => Promise<T>) => TenantContext.run(org, fn);

  const wipe = async () => {
    for (const org of [A, B]) {
      await inOrg(org, async () => {
        await db.serviceOrderStatusLog.deleteMany();
        await db.serviceOrder.deleteMany();
        await db.vehicleOwner.deleteMany();
        await db.vehicle.deleteMany();
        await db.customer.deleteMany();
        await db.part.deleteMany();
        await db.fiscalSyncState.deleteMany();
        await db.fiscalCredential.deleteMany();
        await db.tenantFiscalSettings.deleteMany();
        await db.user.deleteMany();
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

  afterEach(() => TenantContext.useFallbackForTests(TEST_ORG));

  /** Cliente + veículo + usuário + OS dentro da organização atual. */
  async function seedOrder(tag: string, document = `doc-${tag}`, plate = `PL-${tag}`) {
    const user = await db.user.upsert({
      where: { orgId_keycloakId: { orgId: TenantContext.require(), keycloakId: `kc-${tag}` } },
      create: { keycloakId: `kc-${tag}`, email: `${tag}@x.test`, name: tag },
      update: {},
    });
    const customer = await db.customer.create({ data: { name: `Cliente ${tag}`, document } });
    const vehicle = await db.vehicle.create({ data: { plate, brand: 'Fiat', model: 'Palio' } });
    return db.serviceOrder.create({
      data: { portalToken: `pt-${tag}-${Math.random()}`, linkCode: `lc-${tag}-${Math.random()}`, customerId: customer.id, vehicleId: vehicle.id, createdById: user.id },
    });
  }

  it('cada organização enxerga só as suas linhas', async () => {
    await inOrg(A, () => seedOrder('a1'));
    await inOrg(B, () => seedOrder('b1'));

    expect((await inOrg(A, () => db.customer.findMany())).map((c) => c.name)).toEqual(['Cliente a1']);
    expect((await inOrg(B, () => db.customer.findMany())).map((c) => c.name)).toEqual(['Cliente b1']);
    expect(await inOrg(A, () => db.serviceOrder.count())).toBe(1);
    expect(await inOrg(B, () => db.vehicle.count())).toBe(1);
  });

  it('o mesmo CPF/CNPJ, placa e usuário podem existir em duas organizações (unicidade é por organização)', async () => {
    await wipe();
    await inOrg(A, () => seedOrder('x', '12345678901', 'ABC1D23'));
    await inOrg(B, () => seedOrder('x', '12345678901', 'ABC1D23'));
    // ...mas não duas vezes na mesma
    await expect(inOrg(A, () => db.customer.create({ data: { name: 'Dup', document: '12345678901' } }))).rejects.toThrow();
  });

  it('buscar por id de OUTRA organização não acha nada (nem por chave única)', async () => {
    await wipe();
    const orderA = await inOrg(A, () => seedOrder('p'));
    expect(await inOrg(B, () => db.serviceOrder.findUnique({ where: { id: orderA.id } }))).toBeNull();
    expect(await inOrg(B, () => db.serviceOrder.update({ where: { id: orderA.id }, data: { description: 'invasão' } }).catch(() => 'recusado'))).toBe('recusado');
    expect(await inOrg(B, () => db.serviceOrder.deleteMany({ where: { id: orderA.id } }))).toEqual({ count: 0 });
    expect((await inOrg(A, () => db.serviceOrder.findUnique({ where: { id: orderA.id } })))?.description).toBeNull();
  });

  it('o banco recusa gravar com o orgId de outra organização', async () => {
    await wipe();
    await expect(inOrg(B, () => db.customer.create({ data: { name: 'Invasor', document: '999', orgId: A } }))).rejects.toThrow(/row-level security/i);
  });

  it('numeração das ordens é por organização e sem repetição sob concorrência', async () => {
    await wipe();
    const mk = async (org: string, n: number) =>
      inOrg(org, async () => {
        const base = await seedOrder(`n${n}-${org.slice(0, 2)}`, `d${org.slice(0, 2)}${n}`, `P${org.slice(0, 2)}${n}`);
        return base.number;
      });
    const numbersA = await Promise.all([1, 2, 3, 4, 5].map((n) => mk(A, n)));
    const numbersB = await Promise.all([1, 2, 3].map((n) => mk(B, n)));
    expect([...numbersA].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
    expect([...numbersB].sort((x, y) => x - y)).toEqual([1, 2, 3]); // B começa em 1, independente de A
  });

  it('sem organização no contexto, tabela de oficina falha ALTO (nunca devolve lista vazia)', async () => {
    TenantContext.useFallbackForTests(undefined);
    await expect(db.customer.findMany()).rejects.toBeInstanceOf(TenantContextMissing);
    await expect(db.customer.create({ data: { name: 'x' } })).rejects.toBeInstanceOf(TenantContextMissing);
  });

  it('tabelas compartilhadas funcionam sem organização', async () => {
    TenantContext.useFallbackForTests(undefined);
    const plate = `SHARED${Date.now() % 100000}`;
    await db.plateLookup.create({ data: { plate, rawResponse: {} } });
    expect(await db.plateLookup.findUnique({ where: { plate } })).not.toBeNull();
    await db.plateLookup.delete({ where: { plate } });
  });

  it('SQL cru e transação interativa também respeitam a organização', async () => {
    await wipe();
    await inOrg(A, () => seedOrder('r1'));
    await inOrg(B, () => seedOrder('r2'));
    const raw = (org: string) => inOrg(org, () => db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Customer"`);
    expect(Number((await raw(A))[0]!.n)).toBe(1);
    expect(Number((await raw(B))[0]!.n)).toBe(1);
    const viaTx = await inOrg(B, () => db.$transaction(async (tx) => tx.customer.findMany({ select: { name: true } })));
    expect(viaTx).toEqual([{ name: 'Cliente r2' }]);
  });

  it('a organização não vaza entre requisições que reaproveitam a conexão do pool', async () => {
    await wipe();
    await inOrg(A, () => seedOrder('v1'));
    await inOrg(B, () => seedOrder('v2'));
    const jobs = Array.from({ length: 60 }, (_, i) => {
      const org = i % 2 === 0 ? A : B;
      return inOrg(org, async () => (await db.customer.findMany()).map((c) => c.name)).then((names) => ({ org, names }));
    });
    for (const { org, names } of await Promise.all(jobs)) expect(names).toEqual([org === A ? 'Cliente v1' : 'Cliente v2']);
  });

  it('singletons fiscais são um por organização', async () => {
    await wipe();
    for (const org of [A, B]) {
      await inOrg(org, () => db.tenantFiscalSettings.create({ data: { cnpj: org === A ? '11222333000181' : '11444777000161' } }));
    }
    expect((await inOrg(A, () => db.tenantFiscalSettings.findUnique({ where: { orgId: A } })))?.cnpj).toBe('11222333000181');
    expect(await inOrg(A, () => db.tenantFiscalSettings.findUnique({ where: { orgId: B } }))).toBeNull();
  });

  describe('TenantDirectory (cliente de sistema)', () => {
    const directory = () => new TenantDirectory(sys as unknown as SystemPrismaService);

    it('acha a organização dona do token do portal e do código de WhatsApp', async () => {
      await wipe();
      const oa = await inOrg(A, () => seedOrder('t1'));
      const ob = await inOrg(B, () => seedOrder('t2'));
      expect(await directory().orgForPortalToken(oa.portalToken)).toBe(A);
      expect(await directory().orgForPortalToken(ob.portalToken)).toBe(B);
      expect(await directory().orgForLinkCode(ob.linkCode)).toBe(B);
      expect(await directory().orgForPortalToken('inexistente')).toBeNull();
    });

    it('lista as organizações com certificado fiscal habilitado', async () => {
      await wipe();
      const cred = (enabled: boolean, userId: string) => ({
        enabled, pfxCiphertext: Buffer.from('x'), pfxPassCiphertext: Buffer.from('y'), keyId: 'k', subject: 's', certCnpj: '11222333000181',
        notBefore: new Date(0), notAfter: new Date(Date.now() + 86_400_000), uploadedById: userId,
      });
      const ua = await inOrg(A, () => db.user.create({ data: { keycloakId: 'cu-a', email: 'cua@x.test', name: 'a' } }));
      const ub = await inOrg(B, () => db.user.create({ data: { keycloakId: 'cu-b', email: 'cub@x.test', name: 'b' } }));
      await inOrg(A, () => db.fiscalCredential.create({ data: cred(true, ua.id) }));
      await inOrg(B, () => db.fiscalCredential.create({ data: cred(false, ub.id) }));
      expect(await directory().orgsWithFiscalCredential()).toEqual([A]);
    });
  });
});
