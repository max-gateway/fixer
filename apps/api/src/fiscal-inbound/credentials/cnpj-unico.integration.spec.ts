import type { PrismaClient } from '@fixer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acquireDbLock } from '../../../test/fiscal/db-lock.js';
import { tenantClient } from '../../../test/db.js';
import { OTHER_ORG, TEST_ORG } from '../../../test/setup.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { CredentialService, SettingsSchema } from './credential.service.js';

/**
 * Um CNPJ pertence a UMA organização, contra Postgres REAL e com RLS (papel `fixer_rls`). O Fixer é um tenant só no dfe-gateway, que não distingue
 * organizações: duas com o mesmo CNPJ dividiriam assinatura e cursor. Só roda com FISCAL_TEST_DATABASE_URL (banco descartável, já migrado).
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const A = TEST_ORG;
const B = OTHER_ORG;
const CNPJ = '11222333000181';
const OTHER_CNPJ = '11444777000161';
const MESSAGE = 'Este CNPJ já está cadastrado em outra organização';

describe.skipIf(!URL)('CNPJ fiscal único entre organizações (Postgres, RLS)', () => {
  let db: PrismaClient;
  let release: () => Promise<void>;
  let service: CredentialService;
  /** A auditoria aponta para um usuário real da organização (FK). */
  const actors: Record<string, { id: string }> = {};

  const inOrg = <T>(org: string, fn: () => Promise<T>) => TenantContext.run(org, fn);
  const save = (org: string, cnpj: string) => inOrg(org, () => service.updateSettings(SettingsSchema.parse({ cnpj }), actors[org]!));
  const cnpjOf = (org: string) => inOrg(org, async () => (await db.tenantFiscalSettings.findUnique({ where: { orgId: org } }))?.cnpj ?? null);
  const wipe = async () => {
    for (const org of [A, B]) {
      await inOrg(org, async () => {
        await db.fiscalAuditLog.deleteMany();
        await db.fiscalCredential.deleteMany();
        await db.tenantFiscalSettings.deleteMany();
        await db.user.deleteMany();
      });
    }
  };
  const seedUsers = async () => {
    for (const org of [A, B]) actors[org] = await inOrg(org, () => db.user.create({ data: { keycloakId: `kc-${org.slice(0, 4)}`, email: `u-${org.slice(0, 4)}@x.test`, name: 'Admin' }, select: { id: true } }));
  };

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    db = tenantClient(URL!);
    service = new CredentialService(db as never, {} as never);
    await wipe();
  }, 60_000);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
    await release();
  }, 60_000);
  beforeEach(async () => {
    await wipe();
    await seedUsers();
  });

  it('a segunda organização com o mesmo CNPJ recebe 409 sem saber de quem é; a primeira segue intacta e a segunda não grava nada', async () => {
    await save(A, CNPJ);
    await expect(save(B, CNPJ)).rejects.toMatchObject({ status: 409, message: MESSAGE });
    expect(await cnpjOf(A)).toBe(CNPJ);
    expect(await cnpjOf(B)).toBeNull();
    expect(await inOrg(B, () => db.fiscalAuditLog.count())).toBe(0); // a tentativa recusada não deixa rastro de "settings.update"
  });

  it('a própria organização pode regravar o seu CNPJ (não conflita consigo mesma) e trocar para outro livre', async () => {
    await save(A, CNPJ);
    await expect(save(A, CNPJ)).resolves.toMatchObject({ cnpj: CNPJ });
    await expect(save(A, OTHER_CNPJ)).resolves.toMatchObject({ cnpj: OTHER_CNPJ });
    await expect(save(B, CNPJ)).resolves.toMatchObject({ cnpj: CNPJ }); // o CNPJ que A largou ficou livre
  });

  it('organizações com CNPJs diferentes convivem', async () => {
    await save(A, CNPJ);
    await expect(save(B, OTHER_CNPJ)).resolves.toMatchObject({ cnpj: OTHER_CNPJ });
  });

  it('liberar o CNPJ (apagar as configurações da organização, como ao remover o certificado) deixa outra organização usá-lo', async () => {
    await save(A, CNPJ);
    await inOrg(A, () => db.tenantFiscalSettings.deleteMany());
    await expect(save(B, CNPJ)).resolves.toMatchObject({ cnpj: CNPJ });
  });

  it('corrida: duas organizações cadastrando o MESMO CNPJ ao mesmo tempo → exatamente uma ganha, a outra recebe 409', async () => {
    const results = await Promise.allSettled([save(A, CNPJ), save(B, CNPJ)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 409, message: MESSAGE });
    const owners = [await cnpjOf(A), await cnpjOf(B)].filter((c) => c === CNPJ);
    expect(owners).toHaveLength(1);
  });

  it('corrida da MESMA organização (dois envios seguidos, como um duplo clique) não é tratada como CNPJ de outra', async () => {
    const results = await Promise.allSettled([save(A, CNPJ), save(A, CNPJ), save(A, CNPJ)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await cnpjOf(A)).toBe(CNPJ);
  });
});
