import { tenantClient } from '../../test/db.js';
import { randomBytes } from 'node:crypto';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@fixer/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { CnpjLookupClient } from '../cnpj-lookup/cnpj-lookup.client.js';
import { FiscalSettingsModule } from '../fiscal-settings/fiscal-settings.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FiscalAutofillModule } from './fiscal-autofill.module.js';

/**
 * Preenchimento automático por HTTP contra Postgres REAL (sob RLS): migration, proveniência com chave composta,
 * marcação MANUAL pelo PUT /fiscal/settings e a regra de não sobrescrever valor digitado. Só a consulta de CNPJ é falsa.
 * Só roda com FISCAL_TEST_DATABASE_URL e recusa rodar se já houver credencial fiscal no banco.
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const USER = 'itest-autofill-user';
const ROLE = 'itest-autofill-role';
const CNPJ = '11222333000181';

class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = { id: USER, keycloakId: USER, name: 'Teste', email: 'itest-autofill@x.test' };
    return true;
  }
}

let simples: boolean | null = true;
const fakeLookup = {
  consultaCnpj: async (cnpj: string) => ({
    cnpj,
    razao_social: 'OFICINA DO ZE LTDA',
    endereco: { uf: 'PE' },
    cnae_principal: { codigo: '4520001', descricao: 'Serviços de manutenção e reparação mecânica de veículos automotores' },
    telefones: [],
    emails: [],
    inscricoes_estaduais: [],
    raw: { address: { municipality: 2611606 }, company: { simples: { optant: simples }, simei: { optant: false } } },
  }),
};

describe.skipIf(!URL)('Preenchimento automático da configuração fiscal por HTTP (Postgres, integração)', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let release: () => Promise<void>;
  const env = { ...process.env };

  const cleanup = async () => {
    await db.fiscalFieldProvenance.deleteMany();
    await db.tenantTaxProfile.deleteMany();
    await db.fiscalAuditLog.deleteMany({ where: { userId: USER } });
    await db.fiscalCredential.deleteMany();
    await db.tenantFiscalSettings.deleteMany();
    await db.userRole.deleteMany({ where: { userId: USER } });
    await db.rolePermission.deleteMany({ where: { roleId: ROLE } });
    await db.role.deleteMany({ where: { id: ROLE } });
    await db.permission.deleteMany({ where: { id: { startsWith: 'itest-autofill-' } } });
    await db.user.deleteMany({ where: { id: USER } });
  };

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    process.env.DATABASE_URL = URL;
    process.env.FISCAL_ENC_KEYS = JSON.stringify({ k1: randomBytes(32).toString('base64') });
    process.env.FISCAL_ACTIVE_KEY_ID = 'k1';
    process.env.FISCAL_SYNC_ENABLED = 'false';

    db = tenantClient(URL!);
    if ((await db.fiscalCredential.count()) > 0) throw new Error('Há credencial fiscal no banco: recusando rodar o teste de integração');
    await cleanup();
    await db.user.create({ data: { id: USER, keycloakId: USER, name: 'Teste', email: 'itest-autofill@x.test' } });
    await db.role.create({ data: { id: ROLE, name: 'itest-autofill-role' } });
    for (const key of ['fiscal.manage', 'invoices.read']) {
      const perm = await db.permission.upsert({ where: { key }, create: { id: `itest-autofill-${key}`, key, label: key }, update: {} });
      await db.rolePermission.create({ data: { roleId: ROLE, permissionId: perm.id } });
    }
    await db.userRole.create({ data: { userId: USER, roleId: ROLE } });

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, FiscalAutofillModule, FiscalSettingsModule],
      providers: [
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    })
      .overrideProvider(CnpjLookupClient)
      .useValue(fakeLookup)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (db) await cleanup();
    await db?.$disconnect();
    process.env = env;
    await release?.();
  }, 60_000);

  beforeEach(async () => {
    simples = true;
    await db.fiscalFieldProvenance.deleteMany();
    await db.tenantTaxProfile.deleteMany();
    await db.tenantFiscalSettings.deleteMany();
  });

  const http = () => request(app.getHttpServer());

  it('envio do certificado: preenche empresa, município, Simples e serviço, e registra a origem', async () => {
    const res = await http().post('/fiscal/autofill').send({ cnpj: '11.222.333/0001-81' }).expect(201);
    expect(res.body).toMatchObject({ cnpj: CNPJ, reset: 'NENHUM', needsRegime: false, simplesOptant: true });

    const s = await db.tenantFiscalSettings.findFirst();
    expect(s).toMatchObject({ cnpj: CNPJ, legalName: 'OFICINA DO ZE LTDA', ufCode: 26, municipalityIbge: '2611606', taxRegime: 'SIMPLES', cnae: '4520001', lc116Item: '14.01' });

    const prov = await http().get('/fiscal/autofill').expect(200);
    expect(prov.body.simplesOptant).toBe(true);
    expect(prov.body.fields.map((f: { field: string }) => f.field).sort()).toEqual(['cnae', 'lc116Item', 'municipalityIbge', 'taxRegime']);
    expect(await db.fiscalAuditLog.count({ where: { userId: USER, action: 'autofill.run' } })).toBeGreaterThan(0);
  });

  it('não optante: pergunta o regime; a resposta vira MANUAL e libera o ICMS padrão de PE no Presumido', async () => {
    simples = false;
    const first = await http().post('/fiscal/autofill').send({ cnpj: CNPJ }).expect(201);
    expect(first.body).toMatchObject({ needsRegime: true, simplesOptant: false });

    await http().put('/fiscal/settings').send({ taxRegime: 'PRESUMIDO' }).expect(200);
    expect(await db.fiscalFieldProvenance.findFirst({ where: { field: 'taxRegime' } })).toMatchObject({ source: 'MANUAL', confidence: 'INFORMADO', updatedBy: USER });

    const second = await http().post('/fiscal/autofill').send({}).expect(201);
    expect(second.body.needsRegime).toBe(false);
    expect((await db.tenantTaxProfile.findFirst())?.icmsSalePct?.toString()).toBe('20.5');
    expect(await db.fiscalFieldProvenance.findFirst({ where: { field: 'icmsSalePct' } })).toMatchObject({ source: 'TAX_RULES_DEFAULT', confidence: 'ESTIMADO' });
  });

  it('município digitado não é sobrescrito: a resposta traz o conflito', async () => {
    await http().post('/fiscal/autofill').send({ cnpj: CNPJ }).expect(201);
    await http().put('/fiscal/settings').send({ municipalityIbge: '2607901' }).expect(200);

    const res = await http().post('/fiscal/autofill').send({}).expect(201);
    expect(res.body.fields.find((f: { field: string }) => f.field === 'municipalityIbge')).toMatchObject({ outcome: 'CONFLITO', value: '2611606', previous: '2607901' });
    expect((await db.tenantFiscalSettings.findFirst())?.municipalityIbge).toBe('2607901');
  });

  it('valida o CNPJ', async () => {
    await http().post('/fiscal/autofill').send({ cnpj: '123' }).expect(400);
  });
});
