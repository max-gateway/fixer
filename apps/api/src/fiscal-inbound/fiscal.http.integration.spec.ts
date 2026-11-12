import { tenantClient } from '../../test/db.js';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@fixer/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { makePfx } from '../../test/fiscal/make-pfx.js';
import { makeProcNfe } from '../../test/fiscal/nfe-xml.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FiscalInboundModule } from './fiscal-inbound.module.js';

/**
 * HTTP de ponta a ponta (rotas, guards, validação zod, serialização JSON) contra Postgres REAL, com o
 * mesmo caminho que o navegador usa pelo proxy do web. O login é substituído por um guard de teste que
 * injeta o usuário; o `PermissionGuard` é o de verdade.
 * Só roda com FISCAL_TEST_DATABASE_URL e recusa rodar se já houver credencial fiscal no banco.
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const USER = 'itest-http-user';
const ROLE = 'itest-http-role';
const TENANT = '12ABC34501DE35';
const PERMS = ['fiscal.manage', 'invoices.read', 'invoices.reconcile'];

class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = { id: USER, keycloakId: USER, name: 'Teste', email: 'itest-http@x.test' };
    return true;
  }
}

describe.skipIf(!URL)('Importação de NF-e por HTTP (Postgres, integração)', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let release: () => Promise<void>;
  const keys = new Set<string>();
  const env = { ...process.env };

  const cleanup = async () => {
    await db.supplierItemMap.deleteMany({ where: { supplierCnpj: '11222333000181' } });
    await db.purchaseInvoiceItem.deleteMany({ where: { invoice: { accessKey: { in: [...keys] } } } });
    await db.purchaseInvoice.deleteMany({ where: { accessKey: { in: [...keys] } } });
    await db.part.deleteMany({ where: { sku: { startsWith: 'ITEST-' } } });
    await db.fiscalAuditLog.deleteMany({ where: { userId: USER } });
    await db.fiscalSyncState.deleteMany();
    await db.fiscalCredential.deleteMany();
    await db.tenantFiscalSettings.deleteMany({ where: { cnpj: TENANT } });
    await db.userRole.deleteMany({ where: { userId: USER } });
    await db.rolePermission.deleteMany({ where: { roleId: ROLE } });
    await db.role.deleteMany({ where: { id: ROLE } });
    await db.permission.deleteMany({ where: { id: { startsWith: 'itest-http-' } } });
    await db.user.deleteMany({ where: { id: USER } });
  };

  const grant = async (keysToGrant: string[]) => {
    await db.userRole.deleteMany({ where: { userId: USER } });
    await db.rolePermission.deleteMany({ where: { roleId: ROLE } });
    for (const key of keysToGrant) {
      const perm = await db.permission.upsert({ where: { key }, create: { id: `itest-http-${key}`, key, label: key }, update: {} });
      await db.rolePermission.create({ data: { roleId: ROLE, permissionId: perm.id } });
    }
    await db.userRole.create({ data: { userId: USER, roleId: ROLE } });
  };

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    process.env.DATABASE_URL = URL;
    process.env.FISCAL_ENC_KEYS = JSON.stringify({ k1: randomBytes(32).toString('base64') });
    process.env.FISCAL_ACTIVE_KEY_ID = 'k1';
    process.env.FISCAL_SYNC_ENABLED = 'false'; // sem loop de sincronização no teste

    db = tenantClient(URL!);
    if ((await db.fiscalCredential.count()) > 0) throw new Error('Há credencial fiscal no banco: recusando rodar o teste de integração');
    await cleanup();
    await db.user.create({ data: { id: USER, keycloakId: USER, name: 'Teste', email: 'itest-http@x.test' } });
    await db.role.create({ data: { id: ROLE, name: 'itest-http-role' } });

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, FiscalInboundModule],
      providers: [
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await db.$disconnect();
    process.env = env;
    await release();
  }, 60_000);

  beforeEach(async () => {
    await db.supplierItemMap.deleteMany({ where: { supplierCnpj: '11222333000181' } });
    await db.purchaseInvoiceItem.deleteMany({ where: { invoice: { accessKey: { in: [...keys] } } } });
    await db.purchaseInvoice.deleteMany({ where: { accessKey: { in: [...keys] } } });
    await db.part.deleteMany({ where: { sku: { startsWith: 'ITEST-' } } });
    await db.fiscalSyncState.deleteMany();
    await db.fiscalCredential.deleteMany();
    await db.tenantFiscalSettings.deleteMany({ where: { cnpj: TENANT } });
    await grant(PERMS);
  });

  const http = () => request(app.getHttpServer());

  /** Uma nota completa já recebida, como o sync a deixa. */
  async function seedInvoice(number = 1) {
    const n = makeProcNfe({ number });
    keys.add(n.key);
    const inv = await db.purchaseInvoice.create({
      data: {
        accessKey: n.key,
        nsu: 123456789012345n, // BigInt: o JSON puro não serializa
        number,
        series: 1,
        issuedAt: new Date('2026-10-05T13:30:00Z'),
        issuerCnpj: '11222333000181',
        issuerName: 'AUTO PECAS DISTRIBUIDORA LTDA',
        recipientCnpj: TENANT,
        totalAmount: '434.85',
        finality: 1,
        operationType: 1,
        status: 'FULL',
        exportStatus: 'PENDING_MATCH',
        xmlGz: gzipSync(Buffer.from(n.xml)),
        items: {
          create: [
            { itemNumber: 1, supplierCode: 'PAST-001', ean: '7891234567895', description: 'PASTILHA', ncm: '87083090', cfop: '5102', unit: 'CX', quantity: '2', unitPrice: '41.9', totalPrice: '83.8' },
            { itemNumber: 2, supplierCode: 'OLEO-5W30', description: 'OLEO', ncm: '27101932', cfop: '5405', unit: 'UN', quantity: '12', unitPrice: '28.5', totalPrice: '342' },
          ],
        },
      },
    });
    return { ...n, id: inv.id };
  }

  describe('permissões', () => {
    it('sem permissão: 403 em leitura e em escrita, com a chave exigida na mensagem', async () => {
      await grant([]);
      const read = await http().get('/invoices').expect(403);
      expect(read.body.message).toContain('invoices.read');
      await http().put('/fiscal/company').send({ cnpj: TENANT }).expect(403);
      await http().post('/invoices/x/manifest').expect(403);
    });

    it('ler não dá escrever: invoices.read abre a lista, mas a conciliação exige invoices.reconcile', async () => {
      const inv = await seedInvoice();
      await grant(['invoices.read']);
      await http().get('/invoices').expect(200);
      await http().put(`/invoices/${inv.id}/items/1`).send({ action: 'ignore' }).expect(403);
    });
  });

  describe('notas', () => {
    it('/invoices/summary não é engolido por /invoices/:id e bate com a lista', async () => {
      await seedInvoice();
      const summary = await http().get('/invoices/summary').expect(200);
      expect(summary.body).toMatchObject({ pending: expect.any(Number), all: expect.any(Number) });
      const list = await http().get('/invoices?view=pending').expect(200);
      expect(summary.body.pending).toBe(list.body.total);
    });

    it('lista serializa em JSON (sem BigInt), com contagem de itens sem peça', async () => {
      const inv = await seedInvoice();
      const res = await http().get('/invoices?view=pending&q=distribuidora').expect(200);
      const row = res.body.items.find((i: { id: string }) => i.id === inv.id);
      expect(row).toMatchObject({ id: inv.id, itemCount: 2, unresolvedCount: 2, totalAmount: '434.85', status: 'FULL', exportStatus: 'PENDING_MATCH' });
      expect(row).not.toHaveProperty('xmlGz');
    });

    it('detalhe serializa em JSON mesmo com NSU BigInt, traz os itens e nunca o XML', async () => {
      const inv = await seedInvoice();
      const res = await http().get(`/invoices/${inv.id}`).expect(200);
      expect(res.body).toMatchObject({ id: inv.id, hasXml: true, items: [{ itemNumber: 1, part: null }, { itemNumber: 2 }] });
      expect(res.body).not.toHaveProperty('xmlGz');
      expect(res.body).not.toHaveProperty('xmlSha256');
    });

    it('parâmetros inválidos viram 400 com mensagem, e nota inexistente 404', async () => {
      const inv = await seedInvoice();
      expect((await http().get('/invoices?view=xyz').expect(400)).body.message).toBeTruthy();
      await http().get('/invoices?take=1000').expect(400);
      await http().put(`/invoices/${inv.id}/items/abc`).send({ action: 'ignore' }).expect(400);
      const bad = await http().put(`/invoices/${inv.id}/items/1`).send({ action: 'link', partId: '' }).expect(400);
      expect(bad.body.message).toContain('Escolha a peça');
      await http().get('/invoices/nao-existe').expect(404);
      await http().put(`/invoices/${inv.id}/items/99`).send({ action: 'ignore' }).expect(404);
    });

    it('baixa o XML original com os cabeçalhos de download', async () => {
      const inv = await seedInvoice();
      const res = await http().get(`/invoices/${inv.id}/xml`).expect(200);
      expect(res.headers['content-type']).toContain('application/xml');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="NFe${inv.key}.xml"`);
      expect(res.text).toBe(inv.xml);
    });

    it('conciliação completa pela API: cadastrar peça, ignorar o outro item e a nota fica pronta', async () => {
      const inv = await seedInvoice();
      const created = await http()
        .post(`/invoices/${inv.id}/items/1/create-part`)
        .send({ sku: 'ITEST-HTTP', sellPrice: 70, unitFactor: 1, saveMapping: true })
        .expect(201);
      expect(created.body.items[0]).toMatchObject({ resolution: 'MANUAL', part: { sku: 'ITEST-HTTP' } });

      const done = await http().put(`/invoices/${inv.id}/items/2`).send({ action: 'ignore' }).expect(200);
      expect(done.body.exportStatus).toBe('READY');

      // SKU repetido → 409 com a mensagem que a tela mostra
      const conflict = await http().post(`/invoices/${inv.id}/items/1/create-part`).send({ sku: 'ITEST-HTTP', sellPrice: 1 }).expect(409);
      expect(conflict.body.message).toBeTruthy();
    });

    it('preço de venda é opcional no cadastro de peça, mas não pode ser negativo', async () => {
      const inv = await seedInvoice();
      const res = await http().post(`/invoices/${inv.id}/items/1/create-part`).send({ sku: 'ITEST-X', sellPrice: -1 }).expect(400);
      expect(res.body.message).toContain('negativo');
    });
  });

  describe('empresa, certificado e sincronização', () => {
    const cnpj = TENANT;
    const upload = (extra: object = {}) => {
      const { pfx, password } = makePfx({ cnpj });
      return http()
        .post('/fiscal/credentials')
        .send({ pfxBase64: pfx.toString('base64'), password, environment: 'HOMOLOGATION', ...extra });
    };

    it('fluxo da tela: CNPJ → certificado → status → ligar → remover, sem nunca devolver segredo', async () => {
      // 1. empresa (a UI manda o CNPJ já sem máscara; a API aceita com máscara também)
      const company = await http().put('/fiscal/company').send({ cnpj: '12.ABC.345/01DE-35', legalName: 'OFICINA TESTE', ufCode: 35 }).expect(200);
      expect(company.body).toEqual({ cnpj: TENANT, legalName: 'OFICINA TESTE', ufCode: 35 });
      expect((await http().get('/fiscal/company').expect(200)).body.cnpj).toBe(TENANT);

      // 2. certificado
      const up = await upload().expect(201);
      expect(up.body).toMatchObject({ certCnpj: TENANT });
      expect(JSON.stringify(up.body)).not.toMatch(/pfx|password|PRIVATE/i);

      // 3. status serializa BigInt do NSU como string e não vaza ciphertext
      const status = await http().get('/fiscal/status').expect(200);
      expect(status.body).toMatchObject({
        keyAvailable: true,
        settings: { cnpj: TENANT },
        credential: { environment: 'HOMOLOGATION', enabled: false, autoManifest: false, syncState: { lastNsu: '0', maxNsu: '0' } },
      });
      expect(JSON.stringify(status.body)).not.toMatch(/Ciphertext|keyId|password/i);

      // 4. ligar a sincronização
      const on = await http().patch('/fiscal/credentials').send({ enabled: true }).expect(200);
      expect(on.body.credential.enabled).toBe(true);

      // 5. remover: leva junto a configuração fiscal e de precificação, mas não as notas
      await db.pricingRule.deleteMany({ where: { scope: 'DEFAULT' } });
      await db.pricingRule.create({ data: { scope: 'DEFAULT', value: 35 } });
      await db.tenantTaxProfile.deleteMany();
      await db.tenantTaxProfile.create({ data: { icmsSalePct: 18 } });
      const invoice = await seedInvoice(901);
      await http().delete('/fiscal/credentials').expect(200);
      const after = (await http().get('/fiscal/status').expect(200)).body;
      expect(after.credential).toBeNull();
      expect(after.settings).toBeNull();
      expect(await db.pricingRule.count()).toBe(0);
      expect(await db.tenantTaxProfile.count()).toBe(0);
      expect(await db.purchaseInvoice.count({ where: { id: invoice.id } })).toBe(1);
      await http().delete('/fiscal/credentials').expect(404);
    });

    it('alerta de vencimento: exige fiscal.manage, vem null com validade longa e escala perto do vencimento', async () => {
      await grant(['invoices.read']);
      await http().get('/fiscal/certificate-alert').expect(403);
      await grant(PERMS);

      // Sem certificado: objeto com alert null (o corpo nunca vem vazio).
      expect((await http().get('/fiscal/certificate-alert').expect(200)).body).toEqual({ alert: null });

      await http().put('/fiscal/company').send({ cnpj }).expect(200);
      await upload().expect(201);
      expect((await http().get('/fiscal/certificate-alert').expect(200)).body).toEqual({ alert: null });

      const day = 86_400_000;
      await db.fiscalCredential.updateMany({ data: { notAfter: new Date(Date.now() + 5 * day + 60_000) } });
      const soon = (await http().get('/fiscal/certificate-alert').expect(200)).body.alert;
      expect(soon).toMatchObject({ level: 'critical', daysLeft: 5, stale: false });
      expect(JSON.stringify(soon)).not.toMatch(/Ciphertext|keyId|password/i);

      await db.fiscalCredential.updateMany({ data: { notAfter: new Date(Date.now() - 2 * day - 60_000) } });
      expect((await http().get('/fiscal/certificate-alert').expect(200)).body.alert).toMatchObject({ level: 'expired', daysLeft: -2 });
    });

    it('ciência automática exige o aceite da obrigação de manifestação conclusiva', async () => {
      await http().put('/fiscal/company').send({ cnpj }).expect(200);
      await upload().expect(201);
      const refused = await http().patch('/fiscal/credentials').send({ autoManifest: true }).expect(400);
      expect(refused.body.message).toContain('acknowledgeManifestDuty');
      const ok = await http().patch('/fiscal/credentials').send({ autoManifest: true, acknowledgeManifestDuty: true }).expect(200);
      expect(ok.body.credential.autoManifest).toBe(true);
    });

    it('certificado de outra empresa, senha errada e CNPJ inválido são recusados com mensagem legível', async () => {
      await http().put('/fiscal/company').send({ cnpj }).expect(200);

      const other = makePfx({ cnpj: '11222333000181' });
      const wrongCompany = await http().post('/fiscal/credentials').send({ pfxBase64: other.pfx.toString('base64'), password: other.password }).expect(400);
      expect(wrongCompany.body.message).toContain('mesma raiz');

      const wrongPass = await upload({ password: 'errada' }).expect(400);
      expect(wrongPass.body.message).toMatch(/Senha/);
      expect(wrongPass.body.message).not.toContain('errada');

      const badCnpj = await http().put('/fiscal/company').send({ cnpj: '11.222.333/0001-82' }).expect(400);
      expect(badCnpj.body.message).toContain('CNPJ inválido');
    });

    it('sem o CNPJ da empresa cadastrado, o upload é recusado com a instrução certa', async () => {
      const res = await upload().expect(400);
      expect(res.body.message).toContain('Cadastre o CNPJ');
    });

    it('trocar a raiz do CNPJ com certificado enviado → 409', async () => {
      await http().put('/fiscal/company').send({ cnpj }).expect(200);
      await upload().expect(201);
      await http().put('/fiscal/company').send({ cnpj: '11222333000181' }).expect(409);
    });
  });
});
