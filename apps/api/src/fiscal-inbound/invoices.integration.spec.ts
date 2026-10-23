import { TEST_ORG } from '../../test/setup.js';
import { tenantClient } from '../../test/db.js';
import { Prisma, PrismaClient } from '@fixer/db';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ITEM_BRAKE_PAD, ITEM_ICMS00_MONOFASICO, ITEM_ICMS10_FCP, makeDistResponse, makeProcNfe } from '../../test/fiscal/nfe-xml.js';
import { CreatePartSchema, InvoicesService, ItemActionSchema, ListQuerySchema } from './invoices.service.js';
import { parseDistResponse } from './parser/dist-response.parser.js';
import { PricingService } from '../pricing/pricing.service.js';
import { backfillInvoiceTax } from './tax/backfill.js';
import { SyncRunner } from './sync/sync.runner.js';
import { hashContext } from './matching/entry-snapshot.js';

/**
 * Conciliação contra Postgres REAL: aprendizado de vínculo entre notas, cadastro de peça pelo item,
 * máquina PENDING_MATCH ↔ READY e bloqueio de edição depois do lançamento.
 * Só roda com FISCAL_TEST_DATABASE_URL e recusa rodar se já houver credencial fiscal no banco.
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const USER = 'itest-invoices-user';
const TENANT = '12ABC34501DE35';
const SUPPLIER = '11222333000181';
/** Item cujo código do fornecedor já tem o prefixo do teste, para a peça criada com o SKU padrão ser limpa depois. */
const ITEM_CODE_ONLY = ITEM_BRAKE_PAD.replace('PAST-001', 'itest-cod-9');

describe.skipIf(!URL)('InvoicesService (Postgres, integração)', () => {
  let db: PrismaClient;
  let service: InvoicesService;
  const keys = new Set<string>();

  const cleanup = async () => {
    await db.partPriceHistory.deleteMany({ where: { createdById: USER } });
    await db.pricingRule.deleteMany();
    await db.tenantTaxProfile.deleteMany();
    await db.taxTableReview.deleteMany();
    await db.fiscalFieldProvenance.deleteMany();
    await db.supplierItemMap.deleteMany({ where: { supplierCnpj: SUPPLIER } });
    await db.stockEntrySnapshot.deleteMany({ where: { createdById: USER } });
    await db.stockMovement.deleteMany({ where: { createdById: USER } });
    await db.purchaseInvoiceItem.deleteMany({ where: { invoice: { accessKey: { in: [...keys] } } } });
    await db.purchaseInvoice.deleteMany({ where: { accessKey: { in: [...keys] } } });
    await db.part.deleteMany({ where: { sku: { startsWith: 'ITEST-' } } });
    await db.part.deleteMany({ where: { ean: { in: ['7891234567895', '7890000000017'] } } });
    await db.fiscalSyncState.deleteMany();
    await db.fiscalCredential.deleteMany();
    await db.tenantFiscalSettings.deleteMany({ where: { cnpj: TENANT } });
    await db.user.deleteMany({ where: { id: USER } });
  };

  let release: () => Promise<void>;

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    db = tenantClient(URL!);
    if ((await db.fiscalCredential.count()) > 0) throw new Error('Há credencial fiscal no banco: recusando rodar o teste de integração');
    service = new InvoicesService(db as never);
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
    await release();
  }, 60_000);

  beforeEach(async () => {
    await cleanup();
    keys.clear();
    await db.user.create({ data: { id: USER, keycloakId: USER, name: 'Teste', email: 'itest-invoices@x.test' } });
    await db.tenantFiscalSettings.upsert({ where: { orgId: TEST_ORG }, create: { orgId: TEST_ORG, cnpj: TENANT, ufCode: 35 }, update: { cnpj: TENANT, ufCode: 35, taxRegime: null } });
    await db.fiscalCredential.create({
      data: {
        orgId: TEST_ORG,
        enabled: true,
        pfxCiphertext: Buffer.from('x'),
        pfxPassCiphertext: Buffer.from('y'),
        keyId: 'k1',
        subject: 's',
        certCnpj: SUPPLIER,
        notBefore: new Date(0),
        notAfter: new Date(Date.now() + 365 * 86_400_000),
        uploadedById: USER,
      },
    });
    await db.fiscalSyncState.create({ data: { orgId: TEST_ORG, nextPollAt: new Date(0) } });
  });

  /** Entrega a nota pela rodada de sincronização real (SEFAZ falsa), como acontece em produção. */
  async function receive(opts: Parameters<typeof makeProcNfe>[0] = {}) {
    const n = makeProcNfe(opts);
    keys.add(n.key);
    const res = makeDistResponse({ cStat: 138, ultNSU: '1', maxNSU: '1', docs: [{ nsu: '1', schema: 'procNFe_v4.00.xsd', xml: n.xml }] });
    await db.fiscalSyncState.update({ where: { orgId: TEST_ORG }, data: { lastNsu: 0n } });
    const runner = new SyncRunner(
      db as never,
      { openMaterial: async () => ({ keyPem: '', certPem: '', chainPem: [], subject: '', certCnpj: '', notBefore: new Date(0), notAfter: new Date(Date.now() + 1e10), environment: 'HOMOLOGATION' as const }) } as never,
      { distribute: async () => parseDistResponse(res), manifest: async () => ({ batchStatus: 128, batchMotivo: '', events: [] }) },
      { runPending: async () => ({ manifested: 0, rejected: 0, ignored: 0, aborted: null }) } as never,
    );
    await runner.runOnce();
    const inv = await db.purchaseInvoice.findFirstOrThrow({ where: { accessKey: n.key } });
    return { ...n, id: inv.id };
  }
  const part = (sku: string, extra: Record<string, unknown> = {}) =>
    db.part.create({ data: { sku: `ITEST-${sku}`, name: `Peça ${sku}`, costPrice: 1, sellPrice: 2, ...extra } });
  const state = (id: string) => db.purchaseInvoice.findFirstOrThrow({ where: { id } });
  const items = (id: string) => db.purchaseInvoiceItem.findMany({ where: { invoiceId: id }, orderBy: { itemNumber: 'asc' } });

  describe('matcher no recebimento', () => {
    it('GTIN de uma peça resolve o item, aprende o vínculo e a próxima nota resolve por código', async () => {
      const pad = await part('PAD', { ean: '7891234567895' });
      const a = await receive({ number: 1 });
      expect((await items(a.id))[0]).toMatchObject({ resolution: 'AUTO_EAN', partId: pad.id });
      expect(await db.supplierItemMap.findFirst({ where: { supplierCnpj: SUPPLIER, supplierCode: 'PAST-001' } })).toMatchObject({ partId: pad.id });

      await db.part.update({ where: { id: pad.id }, data: { ean: null } }); // sem GTIN no cadastro, só o código do fornecedor
      const b = await receive({ number: 2 });
      expect((await items(b.id))[0]).toMatchObject({ resolution: 'AUTO_MAP', partId: pad.id });
    });

    it('nota com todos os itens conhecidos já nasce READY', async () => {
      const pad = await part('PAD');
      const oil = await part('OIL');
      await db.supplierItemMap.createMany({
        data: [
          { supplierCnpj: SUPPLIER, supplierCode: 'PAST-001', partId: pad.id },
          { supplierCnpj: SUPPLIER, supplierCode: 'OLEO-5W30', partId: oil.id, unitFactor: '1' },
        ],
      });
      const inv = await receive();
      expect(await state(inv.id)).toMatchObject({ status: 'FULL', exportStatus: 'READY' });
    });
  });

  describe('lançamento', () => {
    const ready = async () => {
      const pad = await part('PAD', { unit: 'UN' });
      const oil = await part('OIL', { unit: 'UN' });
      await db.supplierItemMap.createMany({
        data: [
          { supplierCnpj: SUPPLIER, supplierCode: 'PAST-001', partId: pad.id },
          { supplierCnpj: SUPPLIER, supplierCode: 'OLEO-5W30', partId: oil.id },
        ],
      });
      return { pad, oil };
    };

    it('confirm dá entrada no estoque, grava movimento e é idempotente', async () => {
      const { pad } = await ready();
      const inv = await receive();
      expect((await state(inv.id)).exportStatus).toBe('READY');
      await service.confirm(inv.id, USER);
      expect(await state(inv.id)).toMatchObject({ exportStatus: 'POSTED', postedById: USER });
      const mv = await db.stockMovement.findMany({ where: { partId: pad.id } });
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ type: 'PURCHASE', createdById: USER });
      expect((await db.part.findUniqueOrThrow({ where: { id: pad.id } })).stockQty.toString()).toBe(mv[0]!.quantity.toString());
      await service.confirm(inv.id, USER); // segunda chamada não duplica
      expect(await db.stockMovement.count({ where: { partId: pad.id } })).toBe(1);
    });

    it('nota com item pendente não é lançada (409)', async () => {
      const inv = await receive();
      await expect(service.confirm(inv.id, USER)).rejects.toMatchObject({ status: 409 });
      expect(await db.stockMovement.count({ where: { createdById: USER } })).toBe(0);
    });

    it('autoExport lança sozinho ao receber a nota 100% resolvida; desligado, fica READY', async () => {
      await ready();
      const off = await receive({ number: 1 });
      expect((await state(off.id)).exportStatus).toBe('READY');
      await db.fiscalCredential.update({ where: { orgId: TEST_ORG }, data: { autoExport: true, autoExportById: USER } });
      const on = await receive({ number: 2 });
      expect(await state(on.id)).toMatchObject({ exportStatus: 'POSTED', postedById: USER });
    });

    it('autoExport nunca lança nota em revisão', async () => {
      await ready();
      await db.fiscalCredential.update({ where: { orgId: TEST_ORG }, data: { autoExport: true, autoExportById: USER } });
      const inv = await receive({ finNFe: 4 });
      expect((await state(inv.id)).exportStatus).toBe('PENDING_MATCH');
    });

    it('GTIN com unidade diferente da peça não vincula sozinho', async () => {
      await part('PAD', { ean: '7891234567895', unit: 'UN' }); // a nota vem em CX
      const inv = await receive();
      expect((await items(inv.id))[0]).toMatchObject({ resolution: 'UNRESOLVED' });
    });
  });

  describe('conciliação manual', () => {
    it('vincular todos os itens leva a nota a READY; desfazer um a devolve a PENDING_MATCH', async () => {
      const inv = await receive();
      expect((await state(inv.id)).exportStatus).toBe('PENDING_MATCH');
      const pad = await part('PAD');

      await service.setItem(inv.id, 1, { action: 'link', partId: pad.id, unitFactor: 4, saveMapping: false });
      expect((await state(inv.id)).exportStatus).toBe('PENDING_MATCH');
      expect((await items(inv.id))[0]).toMatchObject({ resolution: 'MANUAL', partId: pad.id });
      expect((await items(inv.id))[0]!.unitFactor.toString()).toBe('4');

      await service.setItem(inv.id, 2, { action: 'ignore' }); // óleo de uso na oficina: não é estoque
      expect(await state(inv.id)).toMatchObject({ exportStatus: 'READY' });
      expect((await items(inv.id))[1]).toMatchObject({ resolution: 'IGNORED', partId: null });

      await service.setItem(inv.id, 1, { action: 'reset' });
      expect(await state(inv.id)).toMatchObject({ exportStatus: 'PENDING_MATCH' });
      expect((await items(inv.id))[0]).toMatchObject({ resolution: 'UNRESOLVED', partId: null });
    });

    it('salvar o vínculo resolve sozinho as OUTRAS notas em aberto do mesmo fornecedor', async () => {
      const a = await receive({ number: 1 });
      const b = await receive({ number: 2 });
      const c = await receive({ number: 3, issuer: '10588201000105' }); // outro fornecedor: não pode ser afetado
      const pad = await part('PAD');

      await service.setItem(a.id, 1, { action: 'link', partId: pad.id, unitFactor: 2, saveMapping: true });

      expect((await items(b.id))[0]).toMatchObject({ resolution: 'AUTO_MAP', partId: pad.id });
      expect((await items(b.id))[0]!.unitFactor.toString()).toBe('2');
      expect((await items(c.id))[0]).toMatchObject({ resolution: 'UNRESOLVED' });
    });

    it('sem salvar o vínculo, nada se espalha para outras notas', async () => {
      const a = await receive({ number: 1 });
      const b = await receive({ number: 2 });
      const pad = await part('PAD');
      await service.setItem(a.id, 1, { action: 'link', partId: pad.id, unitFactor: 1, saveMapping: false });
      expect((await items(b.id))[0]).toMatchObject({ resolution: 'UNRESOLVED' });
      expect(await db.supplierItemMap.count({ where: { supplierCnpj: SUPPLIER } })).toBe(0);
    });

    it('nova decisão explícita sobrescreve o vínculo aprendido', async () => {
      const a = await receive({ number: 1 });
      const [p1, p2] = [await part('P1'), await part('P2')];
      await service.setItem(a.id, 1, { action: 'link', partId: p1.id, unitFactor: 1, saveMapping: true });
      await service.setItem(a.id, 1, { action: 'link', partId: p2.id, unitFactor: 3, saveMapping: true });
      const map = await db.supplierItemMap.findFirstOrThrow({ where: { supplierCnpj: SUPPLIER, supplierCode: 'PAST-001' } });
      expect(map.partId).toBe(p2.id);
      expect(map.unitFactor.toString()).toBe('3');
    });

    it('peça inexistente → 400; item inexistente → 404; nota inexistente → 404', async () => {
      const a = await receive();
      await expect(service.setItem(a.id, 1, { action: 'link', partId: 'nao-existe', unitFactor: 1, saveMapping: true })).rejects.toMatchObject({ status: 400 });
      await expect(service.setItem(a.id, 99, { action: 'ignore' })).rejects.toMatchObject({ status: 404 });
      await expect(service.setItem('nao-existe', 1, { action: 'ignore' })).rejects.toMatchObject({ status: 404 });
    });

    it('nota lançada, cancelada ou sem XML completo não aceita mais conciliação (409)', async () => {
      const a = await receive();
      for (const patch of [{ exportStatus: 'POSTED' as const }, { status: 'CANCELED' as const, exportStatus: 'VOIDED' as const }]) {
        await db.purchaseInvoice.update({ where: { id: a.id }, data: patch });
        await expect(service.setItem(a.id, 1, { action: 'ignore' })).rejects.toMatchObject({ status: 409 });
        await expect(service.clearReview(a.id)).rejects.toMatchObject({ status: 409 });
      }
    });

    it('revisão pendente (finalidade ≠ 1) segura a nota em PENDING_MATCH até o usuário liberar', async () => {
      const inv = await receive({ finNFe: 4 });
      expect(await state(inv.id)).toMatchObject({ needsReview: true, exportStatus: 'PENDING_MATCH' });
      await service.setItem(inv.id, 1, { action: 'ignore' });
      await service.setItem(inv.id, 2, { action: 'ignore' });
      expect((await state(inv.id)).exportStatus).toBe('PENDING_MATCH'); // tudo resolvido, mas em revisão
      await service.clearReview(inv.id);
      expect(await state(inv.id)).toMatchObject({ needsReview: false, exportStatus: 'READY' });
    });
  });

  describe('cadastrar peça a partir do item', () => {
    it('cria a peça com NCM, CEST, origem, GTIN, unidade, fornecedor e custo do XML, e já vincula', async () => {
      const inv = await receive();
      const view = await service.createPartFromItem(inv.id, 1, { sku: 'ITEST-NEW', sellPrice: 70, unitFactor: 1, saveMapping: true });

      const created = await db.part.findFirstOrThrow({ where: { sku: 'ITEST-NEW' } });
      expect(created).toMatchObject({
        name: 'PASTILHA DE FREIO DIANTEIRA',
        ean: '7891234567895',
        ncm: '87083090',
        cest: '0107500',
        originCode: 0,
        unit: 'CX',
        supplierName: 'AUTO PECAS DISTRIBUIDORA LTDA',
        fiscalVerified: false,
      });
      expect(created.stockQty.toString()).toBe('0');
      expect(created.costPrice.toString()).toBe('46.075'); // (83.80 − 3.00 + 6.05 + 1.10 + 4.20) ÷ 2
      expect(created.sellPrice.toString()).toBe('70');
      expect(view.items[0]).toMatchObject({ resolution: 'MANUAL', partId: created.id });
      expect(await db.supplierItemMap.count({ where: { supplierCnpj: SUPPLIER, supplierCode: 'PAST-001' } })).toBe(1);
    });

    it('fator de unidade divide o custo e troca a unidade para UN', async () => {
      const inv = await receive();
      await service.createPartFromItem(inv.id, 1, { sku: 'ITEST-BOX', sellPrice: 20, unitFactor: 4, saveMapping: false });
      const created = await db.part.findFirstOrThrow({ where: { sku: 'ITEST-BOX' } });
      expect(created.costPrice.toString()).toBe('11.5188'); // 92.15 ÷ (2 × 4)
      expect(created.unit).toBe('UN');
    });

    it('sem SKU informado usa o código do fornecedor; SKU repetido → 409 e nada é gravado', async () => {
      const inv = await receive();
      // O SKU padrão é o código do fornecedor; o teste usa um prefixo próprio para a limpeza achar a peça.
      await service.createPartFromItem(inv.id, 2, { sku: 'ITEST-OLEO', sellPrice: 50, unitFactor: 1, saveMapping: false });
      expect(await db.part.findFirst({ where: { sku: 'ITEST-OLEO' } })).toBeTruthy();
      const byCode = await receive({ number: 9, items: [ITEM_CODE_ONLY] });
      await service.createPartFromItem(byCode.id, 1, { sellPrice: 5, unitFactor: 1, saveMapping: false });
      expect(await db.part.findFirst({ where: { sku: 'ITEST-COD-9' } })).toBeTruthy();

      await part('DUP');
      await expect(service.createPartFromItem(inv.id, 1, { sku: 'ITEST-DUP', sellPrice: 1, unitFactor: 1, saveMapping: true })).rejects.toMatchObject({ status: 409 });
      expect((await items(inv.id))[0]).toMatchObject({ resolution: 'UNRESOLVED' });
    });
  });

  describe('cadastrar peça a partir do item, a partir de uma peça do catálogo', () => {
    const catalogPart = { sku: 'itest-cat-1', name: 'Pastilha do catálogo', partNumber: 'ITEST-PN-1' };
    const input = { sellPrice: 70, unitFactor: 1, saveMapping: true, catalogSku: 'itest-cat-1' };

    it('grava o vínculo com o catálogo junto; fiscal e custo seguem do XML, e nome e SKU padrão vêm do catálogo', async () => {
      const inv = await receive();
      const view = await service.createPartFromItem(inv.id, 1, input, catalogPart);
      const created = await db.part.findFirstOrThrow({ where: { catalogSku: 'itest-cat-1' } });
      expect(created).toMatchObject({
        sku: 'ITEST-PN-1',
        name: 'Pastilha do catálogo',
        catalogLinkSource: 'CREATED_FROM_CATALOG',
        ncm: '87083090',
        ean: '7891234567895',
        supplierName: 'AUTO PECAS DISTRIBUIDORA LTDA',
      });
      expect(created.catalogLinkedAt).toBeInstanceOf(Date);
      expect(created.costPrice.toString()).toBe('46.075');
      expect(view.items[0]).toMatchObject({ resolution: 'MANUAL', partId: created.id });
    });

    it('o que a pessoa digitar (SKU e nome) vale mais que o do catálogo', async () => {
      const inv = await receive();
      await service.createPartFromItem(inv.id, 1, { ...input, sku: 'ITEST-MEU-SKU', name: 'Meu nome' }, catalogPart);
      expect(await db.part.findFirstOrThrow({ where: { catalogSku: 'itest-cat-1' } })).toMatchObject({ sku: 'ITEST-MEU-SKU', name: 'Meu nome' });
    });

    it('a peça do catálogo já está no estoque: 409 com a mensagem do catálogo, e nada é gravado nem vinculado', async () => {
      await db.part.create({ data: { sku: 'ITEST-HAS', name: 'Já tenho', costPrice: 1, sellPrice: 1, catalogSku: 'itest-cat-1', catalogLinkedAt: new Date(), catalogLinkSource: 'MANUAL' } });
      const inv = await receive();
      const err = await service.createPartFromItem(inv.id, 1, { ...input, sku: 'ITEST-OTHER' }, catalogPart).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 409 });
      expect((err as Error).message).toMatch(/já está no estoque/);
      expect((await items(inv.id))[0]).toMatchObject({ resolution: 'UNRESOLVED' });
    });

    it('SKU repetido com a peça do catálogo ainda livre: 409 com a mensagem do SKU', async () => {
      await part('DUP2');
      const inv = await receive();
      const err = await service.createPartFromItem(inv.id, 1, { ...input, sku: 'ITEST-DUP2' }, catalogPart).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 409 });
      expect((err as Error).message).toMatch(/SKU/);
    });

    it('catalogSku sem a peça do catálogo resolvida antes é erro de uso (400): o serviço nunca confia só no texto do corpo', async () => {
      const inv = await receive();
      await expect(service.createPartFromItem(inv.id, 1, input)).rejects.toMatchObject({ status: 400 });
      expect(await db.part.findFirst({ where: { catalogSku: 'itest-cat-1' } })).toBeNull();
    });
  });

  describe('consulta', () => {
    it('lista por aba, com a contagem de itens sem vínculo, e o resumo bate com as abas', async () => {
      const pending = await receive({ number: 1 });
      const ready = await receive({ number: 2 });
      await service.setItem(ready.id, 1, { action: 'ignore' });
      await service.setItem(ready.id, 2, { action: 'ignore' });
      const summary = await db.purchaseInvoice.create({
        data: { accessKey: `S${'0'.repeat(42)}1`, issuerCnpj: SUPPLIER, issuerName: 'RESUMO LTDA', totalAmount: '10', status: 'SUMMARY' },
      });
      keys.add(summary.accessKey);

      const q = (view: string, extra: object = {}) => service.list(ListQuerySchema.parse({ view, ...extra }));
      const p = await q('pending');
      expect(p.items.map((i) => i.id)).toContain(pending.id);
      expect(p.items.find((i) => i.id === pending.id)).toMatchObject({ itemCount: 2, unresolvedCount: 2 });
      expect((await q('ready')).items.map((i) => i.id)).toContain(ready.id);
      expect((await q('summary')).items.map((i) => i.id)).toContain(summary.id);
      expect((await q('pending')).items.map((i) => i.id)).not.toContain(ready.id);

      const sums = await service.summary();
      for (const view of ['pending', 'ready', 'summary', 'all'] as const) expect(sums[view]).toBe((await q(view)).total);
    });

    it('busca por fornecedor, número e chave de acesso', async () => {
      const a = await receive({ number: 4321 });
      const q = (text: string) => service.list(ListQuerySchema.parse({ view: 'all', q: text })).then((r) => r.items.map((i) => i.id));
      expect(await q('distribuidora')).toContain(a.id);
      expect(await q('4321')).toContain(a.id);
      expect(await q(a.key.slice(10, 30))).toContain(a.id);
      expect(await q('11.222.333/0001-81')).toContain(a.id);
      expect(await q('naoexiste')).not.toContain(a.id);
    });

    it('detalhe traz os itens com a peça vinculada e não vaza o XML', async () => {
      const a = await receive();
      const pad = await part('PAD');
      await service.setItem(a.id, 1, { action: 'link', partId: pad.id, unitFactor: 1, saveMapping: false });
      const view = await service.get(a.id);
      expect(view.hasXml).toBe(true);
      expect(view).not.toHaveProperty('xmlGz');
      expect(view.items[0]!.part).toMatchObject({ id: pad.id, sku: 'ITEST-PAD' });
      expect(view.items[1]!.part).toBeNull();
    });

    it('baixa o XML original, idêntico ao recebido; resumo não tem XML', async () => {
      const a = await receive();
      expect(await service.xml(a.id)).toEqual({ filename: `NFe${a.key}.xml`, xml: a.xml });
      const s = await db.purchaseInvoice.create({ data: { accessKey: `T${'0'.repeat(42)}2`, issuerCnpj: SUPPLIER, issuerName: 'X', totalAmount: '1', status: 'SUMMARY' } });
      keys.add(s.accessKey);
      await expect(service.xml(s.id)).rejects.toMatchObject({ status: 404 });
    });
  });
  describe('captura tributária e custo pelo livro (docs/specs/pricing.md §4.0 e §5.1)', () => {
    const FILTER_INVOICE = {
      items: [ITEM_ICMS10_FCP],
      icmsTot: '<vProd>200.00</vProd><vFrete>20.00</vFrete><vNF>252.00</vNF>',
    };
    const linked = async (sku: string, code: string) => {
      const p = await part(sku);
      await db.supplierItemMap.create({ data: { supplierCnpj: SUPPLIER, supplierCode: code, partId: p.id } });
      return p;
    };

    it('grava o cabeçalho e as linhas tributárias do item como vieram no XML', async () => {
      await linked('FILT', 'FILT-AR');
      const inv = await receive({ ...FILTER_INVOICE, issuerCrt: 3, issuerUf: 'MG', idDest: 2, modFrete: 1 });
      expect(await state(inv.id)).toMatchObject({ issuerCrt: 3, issuerUf: 'MG', recipientUf: 'SP', destIndicator: 2, freightMode: 1 });
      expect((await state(inv.id)).totals).toEqual({ vProd: '200.00', vFrete: '20.00' });
      const [item] = await items(inv.id);
      const tax = await db.purchaseInvoiceItemTax.findUniqueOrThrow({ where: { itemId: item!.id } });
      expect(tax).toMatchObject({ icmsKind: 'CST', icmsCode: '10', pisCst: '01', indTot: 1 });
      expect(tax.fcpSt?.toString()).toBe('5.6');
      expect(tax.icmsSt?.toString()).toBe('26.4');
      expect(tax.ibsCbs).toEqual({ CST: '000', cClassTrib: '000001' });
    });

    it('a tela e o lançamento usam o mesmo custo: FCP-ST e frete só no total entram', async () => {
      const filter = await linked('FILT', 'FILT-AR');
      const inv = await receive(FILTER_INVOICE);
      expect((await state(inv.id)).exportStatus).toBe('READY');

      // 200 + ST 26,40 + FCP-ST 5,60 + frete rateado 20 = 252 ; ÷ 10 = 25,2 (o custo antigo dava 22,64)
      const view = await service.get(inv.id);
      expect(view.items[0]!.cost).toMatchObject({ landed: '25.2', total: '252' });
      expect(view.items[0]!.cost!.components.find((c) => c.code === 'FRETE')).toMatchObject({ allocated: true, source: 'total/vFrete' });
      expect(view.costAlerts.map((a) => a.code)).toContain('TOTAIS_DIVERGENTES');
      expect(view.costRegime).toBe('SIMPLES');

      await service.confirm(inv.id, USER);
      const after = await db.part.findUniqueOrThrow({ where: { id: filter.id } });
      expect(after.costPrice.toString()).toBe('25.2');
      expect(after.stockQty.toString()).toBe('10');
    });

    it('Presumido: o crédito de ICMS abate o custo gravado e o aviso de antecipação aparece', async () => {
      await db.tenantFiscalSettings.update({ where: { orgId: TEST_ORG }, data: { taxRegime: 'PRESUMIDO' } });
      const battery = await linked('BAT', 'BAT-60');
      const inv = await receive({ items: [ITEM_ICMS00_MONOFASICO], idDest: 2, issuerCrt: 3, issuerUf: 'MG' });
      const view = await service.get(inv.id);
      expect(view.costRegime).toBe('PRESUMIDO');
      expect(view.items[0]!.cost).toMatchObject({ landed: '264' }); // (900 − 108 de crédito) ÷ 3
      expect(view.costAlerts.find((a) => a.code === 'ANTECIPACAO_ICMS_POSSIVEL')?.itemNumbers).toEqual([1]);
      await service.confirm(inv.id, USER);
      expect((await db.part.findUniqueOrThrow({ where: { id: battery.id } })).costPrice.toString()).toBe('264');
    });

    it('nota anterior à captura (sem linhas tributárias) cai no cálculo antigo e o backfill a completa sem mexer no custo lançado', async () => {
      const filter = await linked('FILT', 'FILT-AR');
      const inv = await receive(FILTER_INVOICE);
      await service.confirm(inv.id, USER);
      const posted = (await db.part.findUniqueOrThrow({ where: { id: filter.id } })).costPrice.toString();

      // Simula uma nota importada antes da captura.
      await db.purchaseInvoiceItemTax.deleteMany({ where: { item: { invoiceId: inv.id } } });
      await db.purchaseInvoice.update({ where: { id: inv.id }, data: { totals: Prisma.DbNull, issuerCrt: null, destIndicator: null } });
      const legacy = await service.get(inv.id);
      expect(legacy.items[0]!.cost).toMatchObject({ landed: '22.64' }); // 200 + 26,40 (sem FCP-ST nem rateio) ÷ 10

      const first = await backfillInvoiceTax(db as never);
      expect(first).toMatchObject({ scanned: 1, updated: 1, failedIds: [] });
      expect(await db.purchaseInvoiceItemTax.count({ where: { item: { invoiceId: inv.id } } })).toBe(1);
      expect(await state(inv.id)).toMatchObject({ issuerCrt: 1, destIndicator: 1 });

      const second = await backfillInvoiceTax(db as never);
      expect(second.scanned).toBe(0); // idempotente
      expect((await db.part.findUniqueOrThrow({ where: { id: filter.id } })).costPrice.toString()).toBe(posted); // lançada: custo intacto
    });

    it('backfill não toca nota sem XML guardado nem repete nota que não casa', async () => {
      await linked('FILT', 'FILT-AR');
      const inv = await receive(FILTER_INVOICE);
      await db.purchaseInvoiceItemTax.deleteMany({ where: { item: { invoiceId: inv.id } } });
      const r = await backfillInvoiceTax(db as never, { skip: new Set([inv.id]) });
      expect(r.scanned).toBe(0);
    });
  });
  describe('precificação a partir da nota (docs/specs/pricing.md §5 e §6)', () => {
    let pricing: PricingService;
    // Alíquota efetiva e repartição hipotéticas, só de teste: o sistema não traz nenhuma por conta própria.
    const profile = { simplesEffectiveRatePct: 10, icmsSharePct: 30, pisSharePct: 5, cofinsSharePct: 20, requireTaxConfirmation: false };
    const rule = { method: 'MARGIN' as const, value: 40, taxPctOverride: null, overheadPct: 0, rounding: 'CENTS_90' as const, minMarginPct: 20, maxJumpPct: 25 };

    beforeEach(() => {
      pricing = new PricingService(db as never);
    });

    /** Filtro de ar com ST cobrada: custo (200 + 26,40 + 5,60) ÷ 10 = 23,20. */
    async function setup(opts: { sell?: number; stock?: number; withRule?: boolean; withProfile?: boolean } = {}) {
      if (opts.withRule !== false) await pricing.saveRule(rule);
      if (opts.withProfile !== false) await pricing.saveTaxProfile(profile);
      const p = await part('FILT', { sellPrice: opts.sell ?? 40, costPrice: 10, stockQty: opts.stock ?? 0 });
      await db.supplierItemMap.create({ data: { supplierCnpj: SUPPLIER, supplierCode: 'FILT-AR', partId: p.id } });
      const inv = await receive({ items: [ITEM_ICMS10_FCP] });
      return { p, inv };
    }
    const row = async (id: string) => (await pricing.preview(id)).rows[0]!;

    it('sugere pela regra: custo 23,20, ST cobrada tira o ICMS (imposto 7%) e arredonda para cima em ,90', async () => {
      const { inv } = await setup();
      const r = await row(inv.id);
      // 23,20 ÷ (1 − (40 + 7)%) = 43,77 → 43,90
      expect(r).toMatchObject({ cost: '23.2', suggested: '43.9', proposed: '43.9', currentPrice: '40', locked: false });
      expect(r.saleTax).toMatchObject({ pct: '7', confidence: 'ESTIMADO' });
      expect(r.saleTax.components.find((c) => c.code === 'ICMS')?.reason).toMatch(/substituição tributária/);
      expect(r.flags).toEqual(['COST_SPIKE']); // o custo da peça era 10: o salto aparece como aviso, sem bloquear
      expect(r.blocking).toEqual([]);
      expect(Number(r.marginPct)).toBeGreaterThan(40);
    });

    it('com perfil de custos publicado, as despesas vêm dele (estrutura + venda + extra por unidade) e o lançamento grava a versão', async () => {
      const cp = { status: 'OK' as const, version: 7, channel: 'BALCAO', fixedPct: '10', variablePct: '3', financialPct: '1', extraUnitCost: '0.8', confidence: 'CONFIRMADO' as const };
      const provider = { forPricing: async () => cp };
      const withProfile = new PricingService(db as never, provider as never);
      const { p, inv } = await setup();
      const plan = await withProfile.preview(inv.id);
      expect(plan.costProfile).toMatchObject({ status: 'OK', version: 7 });
      // (23,20 + 0,80) ÷ (1 − (40 + 7 + 4 + 10)%) = 61,54 → 61,90
      expect(plan.rows[0]).toMatchObject({ cost: '23.2', suggested: '61.9', overhead: { source: 'PROFILE', variablePct: '4', fixedPct: '10', extraUnitCost: '0.8' } });
      expect(Number(plan.rows[0]!.marginPct)).toBeCloseTo(40.2, 1);

      // 30 cobre custo, imposto e despesas de venda, mas não a estrutura: pede ciência; 26 nem isso: bloqueia
      const mid = await withProfile.saveDraft(inv.id, 2, { sellPrice: 30 });
      expect(mid.rows[0]!.flags).toContain('BELOW_BREAK_EVEN');
      expect(mid.rows[0]!.blocking).toContain('BELOW_BREAK_EVEN');
      const low = await withProfile.saveDraft(inv.id, 2, { sellPrice: 26 });
      expect(low.rows[0]!.blocking).toContain('BELOW_COST_AFTER_TAX');

      // 40 → 61,90 é alta de 55%, acima do limite de 25% da regra: a estrutura entrando no preço pede "estou ciente"
      const big = await withProfile.saveDraft(inv.id, 2, { sellPrice: 61.9 });
      expect(big.rows[0]!.blocking).toEqual(['BIG_JUMP']);
      await withProfile.saveDraft(inv.id, 2, { sellPrice: 61.9, ack: true });
      await new InvoicesService(db as never, provider as never).confirm(inv.id, USER, { applyPricing: true });
      expect((await db.part.findUniqueOrThrow({ where: { id: p.id } })).sellPrice.toString()).toBe('61.9');
      expect((await db.part.findUniqueOrThrow({ where: { id: p.id } })).costPrice.toString()).toBe('23.2'); // o extra não vai para o custo da peça
      const snap = await db.stockEntrySnapshot.findFirstOrThrow({ where: { partId: p.id } });
      expect(snap.costProfileVersion).toBe(7);
      expect(snap.context).toMatchObject({ price: { overhead: { source: 'PROFILE', fixedPct: '10' } }, engines: { costProfileVersion: 7 } });
    });

    it('sem perfil (motor desligado ou fora do ar), vale a despesa da regra como sempre', async () => {
      const { inv } = await setup();
      const down = new PricingService(db as never, { forPricing: async () => ({ status: 'UNAVAILABLE' }) } as never);
      const plan = await down.preview(inv.id);
      expect(plan.costProfile).toEqual({ status: 'UNAVAILABLE' });
      expect(plan.rows[0]).toMatchObject({ suggested: '43.9', overhead: { source: 'RULE', fixedPct: '0' } });
    });

    it('sem regra ou sem alíquota do contador não inventa preço', async () => {
      const a = await setup({ withRule: false });
      expect(await row(a.inv.id)).toMatchObject({ suggested: null, proposed: null, flags: ['NO_RULE'] });
      await cleanup();
      await db.user.create({ data: { id: USER, keycloakId: USER, name: 'Teste', email: 'itest-invoices@x.test' } });
      await db.tenantFiscalSettings.upsert({ where: { orgId: TEST_ORG }, create: { orgId: TEST_ORG, cnpj: TENANT, ufCode: 35 }, update: {} });
      await db.fiscalCredential.create({ data: { orgId: TEST_ORG, enabled: true, pfxCiphertext: Buffer.from('x'), pfxPassCiphertext: Buffer.from('y'), keyId: 'k1', subject: 's', certCnpj: SUPPLIER, notBefore: new Date(0), notAfter: new Date(Date.now() + 365 * 86_400_000), uploadedById: USER } });
      await db.fiscalSyncState.create({ data: { orgId: TEST_ORG, nextPollAt: new Date(0) } });
      const b = await setup({ withProfile: false });
      const r = await row(b.inv.id);
      expect(r).toMatchObject({ suggested: null, proposed: null, flags: ['TAX_UNAVAILABLE'] });
      expect(r.saleTax.unavailable).toBe('SEM_ALIQUOTA');
    });

    it('lançar COM preço grava custo, custo médio, preço, histórico e o snapshot do cálculo', async () => {
      const { p, inv } = await setup({ stock: 5 });
      await service.confirm(inv.id, USER, { applyPricing: true });
      const after = await db.part.findUniqueOrThrow({ where: { id: p.id } });
      expect(after.sellPrice.toString()).toBe('43.9');
      expect(after.costPrice.toString()).toBe('23.2');
      expect(after.stockQty.toString()).toBe('15');
      expect(after.avgCost?.toString()).toBe('18.8'); // (5 × 10 + 10 × 23,20) ÷ 15, o saldo antes pesa com o custo anterior

      const hist = await db.partPriceHistory.findMany({ where: { partId: p.id } });
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ source: 'INVOICE', createdById: USER, taxRulesVersion: expect.any(String) });
      expect(hist[0]!.sellBefore?.toString()).toBe('40');
      expect(hist[0]!.sellAfter.toString()).toBe('43.9');
      expect(hist[0]!.costBefore?.toString()).toBe('10');

      const [item] = await items(inv.id);
      expect(item!.appliedSellPrice?.toString()).toBe('43.9');
      expect(item!.suggestedSellPrice?.toString()).toBe('43.9');
      expect(item!.saleTaxSnapshot).toMatchObject({ pct: '7' });
      expect((item!.costSnapshot as { landed: string }).landed).toBe('23.2');

      // fotografia imutável do lançamento, ligada ao movimento e ao histórico de preço
      const mov = await db.stockMovement.findFirstOrThrow({ where: { partId: p.id, type: 'PURCHASE' } });
      expect(mov.unitCost?.toString()).toBe('23.2');
      expect(mov.avgCostBefore?.toString()).toBe('10');
      expect(mov.avgCostAfter?.toString()).toBe('18.8');
      const snap = await db.stockEntrySnapshot.findUniqueOrThrow({ where: { stockMovementId: mov.id } });
      expect(snap).toMatchObject({ partId: p.id, purchaseInvoiceItemId: item!.id, priceChanged: true, schemaVersion: 1 });
      expect(snap.unitCost.toString()).toBe('23.2');
      expect(snap.sellPriceAfter.toString()).toBe('43.9');
      expect(snap.context).toMatchObject({
        price: { outcome: 'APPLIED', before: '40', after: '43.9', suggested: '43.9', priceHistoryId: hist[0]!.id, rule: { method: 'MARGIN' } },
        saleTax: { pct: '7', confidence: 'ESTIMADO' },
        stock: { quantity: '10', before: { stockQty: '5', costPrice: '10' }, after: { stockQty: '15', avgCost: '18.8' } },
        engines: { taxRulesVersion: snap.taxRulesVersion },
      });
      // o hash recalculado sobre o que voltou do JSONB bate: nada foi alterado
      expect(hashContext(snap.context)).toBe(snap.contentHash);
      const { entries } = await pricing.entries(p.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: snap.id, unitCost: '23.2', sellPriceAfter: '43.9', priceChanged: true, intact: true });
    });

    it('o snapshot é imutável: UPDATE é recusado pelo banco', async () => {
      const { p, inv } = await setup();
      await service.confirm(inv.id, USER, { applyPricing: true });
      const snap = await db.stockEntrySnapshot.findFirstOrThrow({ where: { partId: p.id } });
      await expect(db.stockEntrySnapshot.update({ where: { id: snap.id }, data: { unitCost: 1 } })).rejects.toThrow(/imutável/);
    });

    it('lançar SEM pedir preço nunca muda o preço de venda (comportamento de sempre)', async () => {
      const { p, inv } = await setup();
      await service.confirm(inv.id, USER);
      const after = await db.part.findUniqueOrThrow({ where: { id: p.id } });
      expect(after.sellPrice.toString()).toBe('40');
      expect(after.costPrice.toString()).toBe('23.2');
      expect(await db.partPriceHistory.count({ where: { partId: p.id } })).toBe(0);
      // sem preço também fica a fotografia: custo, estoque e o preço que a regra teria sugerido
      const snap = await db.stockEntrySnapshot.findFirstOrThrow({ where: { partId: p.id } });
      expect(snap.priceChanged).toBe(false);
      expect(snap.context).toMatchObject({ price: { outcome: 'NOT_REQUESTED', before: '40', after: '40', suggested: '43.9', priceHistoryId: null } });
      expect(hashContext(snap.context)).toBe(snap.contentHash);
    });

    it('preço escolhido vale no lugar da sugestão; limpar o rascunho volta à sugestão', async () => {
      const { p, inv } = await setup();
      const set = await pricing.saveDraft(inv.id, 2, { sellPrice: 45.5 });
      expect(set.rows[0]).toMatchObject({ draft: '45.5', proposed: '45.5', suggested: '43.9' });
      await service.confirm(inv.id, USER, { applyPricing: true });
      expect((await db.part.findUniqueOrThrow({ where: { id: p.id } })).sellPrice.toString()).toBe('45.5');

      const other = await receive({ items: [ITEM_ICMS10_FCP], number: 99 });
      await pricing.saveDraft(other.id, 2, { sellPrice: 50 });
      const cleared = await pricing.saveDraft(other.id, 2, { sellPrice: null });
      expect(cleared.rows[0]).toMatchObject({ draft: null, proposed: '43.9' });
    });

    it('preço abaixo do custo bloqueia o lançamento inteiro (422) e nada é gravado, nem com ciência', async () => {
      const { p, inv } = await setup({ stock: 3 });
      await pricing.saveDraft(inv.id, 2, { sellPrice: 20, ack: true });
      expect((await row(inv.id)).blocking).toContain('BELOW_COST');
      await expect(service.confirm(inv.id, USER, { applyPricing: true })).rejects.toMatchObject({ status: 422 });
      const after = await db.part.findUniqueOrThrow({ where: { id: p.id } });
      expect(after.stockQty.toString()).toBe('3'); // a entrada também foi desfeita
      expect(after.sellPrice.toString()).toBe('40');
      expect((await state(inv.id)).exportStatus).toBe('READY');
      expect(await db.stockMovement.count({ where: { partId: p.id } })).toBe(0);
    });

    it('margem abaixo do mínimo e salto grande pedem ciência; com "estou ciente" lança', async () => {
      const { p, inv } = await setup({ sell: 100 });
      // sugerido 43,90 contra preço atual 100: queda de 56% e margem líquida ainda boa → só BIG_JUMP e PRICE_DOWN
      const r = await row(inv.id);
      expect(r.flags).toEqual(expect.arrayContaining(['BIG_JUMP', 'PRICE_DOWN']));
      expect(r.blocking).toContain('BIG_JUMP');
      await expect(service.confirm(inv.id, USER, { applyPricing: true })).rejects.toMatchObject({ status: 422 });

      await pricing.saveDraft(inv.id, 2, { sellPrice: 43.9, ack: true });
      expect((await row(inv.id)).blocking).toEqual([]);
      await service.confirm(inv.id, USER, { applyPricing: true });
      expect((await db.part.findUniqueOrThrow({ where: { id: p.id } })).sellPrice.toString()).toBe('43.9');
    });

    it('mudar o preço depois do "estou ciente" derruba a ciência', async () => {
      const { inv } = await setup({ sell: 100 });
      await pricing.saveDraft(inv.id, 2, { sellPrice: 43.9, ack: true });
      expect((await row(inv.id)).ack).toBe(true);
      const again = await pricing.saveDraft(inv.id, 2, { sellPrice: 44.9 });
      expect(again.rows[0]!.ack).toBe(false);
    });

    it('peça travada em MANUAL: sem sugestão, preço intocado mesmo lançando com preço', async () => {
      const { p, inv } = await setup();
      await pricing.setPricingMode(p.id, 'MANUAL');
      const r = await row(inv.id);
      expect(r).toMatchObject({ locked: true, proposed: null });
      expect(r.flags).toContain('LOCKED');
      await service.confirm(inv.id, USER, { applyPricing: true });
      expect((await db.part.findUniqueOrThrow({ where: { id: p.id } })).sellPrice.toString()).toBe('40');
      expect(await db.partPriceHistory.count({ where: { partId: p.id } })).toBe(0);
    });

    it('enquadramento confirmado na peça vale mais que o XML e libera o imposto como CONFIRMADO', async () => {
      const { p, inv } = await setup();
      await pricing.reviewTaxProfile({ reviewedBy: 'Contador Teste' });
      await pricing.reviewTaxTable('simples-comercio', { reviewedBy: 'Contador Teste' });
      expect((await row(inv.id)).saleTax.confidence).toBe('ESTIMADO'); // perfil e tabela revisados, peça ainda não
      // o contador diz que esta peça NÃO tem ST: o imposto volta para a alíquota cheia
      await pricing.setTaxFlags(p.id, { icmsStStatus: 'NOT_ST', pisCofinsMonofasico: false });
      const r = await row(inv.id);
      expect(r.saleTax).toMatchObject({ pct: '10', confidence: 'CONFIRMADO' });
      expect(r.suggested).toBe('46.9'); // 23,20 ÷ 0,5 = 46,40 → 46,90
    });

    it('mudar um percentual do perfil derruba a validação do contador', async () => {
      await pricing.saveTaxProfile(profile);
      await pricing.reviewTaxProfile({ reviewedBy: 'Contador Teste' });
      expect((await pricing.getTaxProfile()).profile?.reviewedBy).toBe('Contador Teste');
      await pricing.saveTaxProfile({ ...profile, requireTaxConfirmation: true });
      expect((await pricing.getTaxProfile()).profile?.reviewedBy).toBe('Contador Teste'); // só a opção mudou
      await pricing.saveTaxProfile({ ...profile, simplesEffectiveRatePct: 12 });
      expect((await pricing.getTaxProfile()).profile).toMatchObject({ reviewedBy: null, reviewedAt: null });
    });

    it('tabela conferida com a lei vale como validada; o aceite do contador vem antes e cai com a versão', async () => {
      const { p, inv } = await setup();
      await pricing.setTaxFlags(p.id, { icmsStStatus: 'NOT_ST', pisCofinsMonofasico: false });
      // Alíquota e repartição digitadas: só o contador garante o perfil.
      expect((await row(inv.id)).saleTax.confidence).toBe('ESTIMADO');
      await pricing.reviewTaxProfile({ reviewedBy: 'Contador Teste' });
      // A tabela do Simples está conferida com o texto da lei (verify:sources) na versão em uso.
      expect((await row(inv.id)).saleTax.confidence).toBe('CONFIRMADO');
      let listed = await pricing.taxTables();
      expect(listed.tables.find((t) => t.id === 'simples-comercio')).toMatchObject({ review: null, basis: 'FONTE_OFICIAL', sourceCheck: { checkedAt: expect.any(String) } });
      await pricing.reviewTaxTable('simples-comercio', { reviewedBy: 'Contador Teste' });
      listed = await pricing.taxTables();
      expect(listed.tables.find((t) => t.id === 'simples-comercio')).toMatchObject({ review: { reviewedBy: 'Contador Teste', current: true }, basis: 'CONTADOR' });
      // simula tabela nova: o aceite foi dado para outra versão; a conferência com a fonte continua garantindo
      await db.taxTableReview.updateMany({ data: { version: 'versao-antiga' } });
      expect((await pricing.taxTables()).tables.find((t) => t.id === 'simples-comercio')).toMatchObject({ review: { current: false }, basis: 'FONTE_OFICIAL' });
      expect((await row(inv.id)).saleTax.confidence).toBe('CONFIRMADO');
      // validar de novo reaproveita a linha em vez de duplicar
      await pricing.reviewTaxTable('simples-comercio', { reviewedBy: 'Outra Contadora' });
      expect(await db.taxTableReview.count()).toBe(1);
    });

    it('RBT12 do PGDAS-D dispensa o contador; estimada pelas OS, não', async () => {
      const { p, inv } = await setup({ withProfile: false });
      await pricing.setTaxFlags(p.id, { icmsStStatus: 'NOT_ST', pisCofinsMonofasico: true });
      await pricing.saveTaxProfile({ rbt12: 300000, simplesEffectiveRatePct: null, icmsSharePct: null, pisSharePct: null, cofinsSharePct: null, requireTaxConfirmation: false });
      await db.tenantFiscalSettings.update({ where: { orgId: TEST_ORG }, data: { taxRegime: 'SIMPLES' } });
      await db.fiscalFieldProvenance.upsert({
        where: { orgId_field: { orgId: TEST_ORG, field: 'rbt12' } },
        create: { orgId: TEST_ORG, field: 'rbt12', source: 'FIXER_ESTIMATE', confidence: 'ESTIMADO' },
        update: { source: 'FIXER_ESTIMATE', confidence: 'ESTIMADO' },
      });
      expect((await row(inv.id)).saleTax.confidence).toBe('ESTIMADO');
      let r = await pricing.getTaxProfile();
      expect(r.readiness.steps.find((s) => s.id === 'perfil')).toMatchObject({ done: false, needsAccountant: true });

      await db.fiscalFieldProvenance.update({ where: { orgId_field: { orgId: TEST_ORG, field: 'rbt12' } }, data: { source: 'INTEGRA_PGDASD', confidence: 'OFICIAL', reference: 'PGDAS-D 09/2026' } });
      // Peça monofásica: vale também a tabela de monofásico, conferida com a lei.
      expect((await row(inv.id)).saleTax.confidence).toBe('CONFIRMADO');
      r = await pricing.getTaxProfile();
      expect(r.profile).toMatchObject({ trust: 'FONTE_OFICIAL', origin: { source: 'INTEGRA_PGDASD' } });
      expect(r.readiness).toMatchObject({ ready: true });
    });

    it('enquadramento: a linha mostra o que está salvo; "não sei" não confirma e meia resposta é recusada', async () => {
      const { p, inv } = await setup();
      await pricing.reviewTaxProfile({ reviewedBy: 'Contador Teste' });
      expect((await row(inv.id)).taxFlags).toMatchObject({ confirmed: false, icmsStStatus: 'UNKNOWN', pisCofinsMonofasico: null, xml: { st: true, monofasico: false } });

      await pricing.setTaxFlags(p.id, { icmsStStatus: 'ST_CHARGED', pisCofinsMonofasico: false });
      let r = await row(inv.id);
      expect(r.taxFlags).toMatchObject({ confirmed: true, icmsStStatus: 'ST_CHARGED', pisCofinsMonofasico: false });
      expect(r.saleTax.confidence).toBe('CONFIRMADO');

      await expect(pricing.setTaxFlags(p.id, { icmsStStatus: 'UNKNOWN', pisCofinsMonofasico: false })).rejects.toMatchObject({ status: 400 });
      await pricing.setTaxFlags(p.id, { icmsStStatus: 'UNKNOWN', pisCofinsMonofasico: null });
      r = await row(inv.id);
      expect(r.taxFlags.confirmed).toBe(false);
      expect(r.saleTax.confidence).toBe('ESTIMADO');

      // Registro antigo com "não sei" gravado como MANUAL não vale como confirmação.
      await db.part.update({ where: { id: p.id }, data: { icmsStStatus: 'UNKNOWN', pisCofinsMonofasico: false, taxFlagsSource: 'MANUAL' } });
      expect((await row(inv.id)).saleTax.confidence).toBe('ESTIMADO');
    });

    it('tabela de regra desconhecida é recusada', async () => {
      await expect(pricing.reviewTaxTable('nao-existe', { reviewedBy: 'Contador Teste' })).rejects.toMatchObject({ status: 404 });
    });

    it('as tabelas de regra em uso são listadas com fonte e vigência', async () => {
      const t = await pricing.taxTables();
      expect(t.tables.length).toBeGreaterThanOrEqual(10);
      for (const x of t.tables) expect(x.sources.length).toBeGreaterThan(0);
      expect(t.rulesVersion).toContain('simples-comercio@');
    });

    it('percentuais que somam 100% ou mais são recusados ao salvar a regra', async () => {
      await expect(pricing.saveRule({ ...rule, value: 90, overheadPct: 10 })).rejects.toMatchObject({ status: 400 });
      await expect(pricing.saveRule({ ...rule, method: 'MARKUP', taxPctOverride: 70, overheadPct: 30 })).rejects.toMatchObject({ status: 400 });
    });

    it('nota já lançada não aceita mais rascunho de preço nem prévia', async () => {
      const { inv } = await setup();
      await service.confirm(inv.id, USER);
      await expect(pricing.saveDraft(inv.id, 2, { sellPrice: 50 })).rejects.toMatchObject({ status: 409 });
      await expect(pricing.preview(inv.id)).rejects.toMatchObject({ status: 409 });
    });

    it('item sem peça vinculada não recebe preço', async () => {
      await pricing.saveRule(rule);
      const inv = await receive({ items: [ITEM_ICMS10_FCP] });
      await expect(pricing.saveDraft(inv.id, 2, { sellPrice: 50 })).rejects.toMatchObject({ status: 409 });
      expect((await pricing.preview(inv.id)).rows).toEqual([]);
    });

    describe('regras por fornecedor, NCM e peça, lote e histórico (fase 2)', () => {
      const m = (value: number) => ({ ...rule, value });

      it('a regra mais específica vence: fornecedor > padrão; NCM > fornecedor; peça > NCM', async () => {
        const { p, inv } = await setup();
        expect((await row(inv.id)).suggested).toBe('43.9'); // padrão: margem 40

        await pricing.saveScopedRule({ ...m(20), scope: 'SUPPLIER', scopeKey: '11.222.333/0001-81' }); // pontuação é normalizada
        // 23,20 ÷ (1 − (20 + 7)%) = 31,78 → 31,90
        expect(await row(inv.id)).toMatchObject({ suggested: '31.9', ruleScope: 'SUPPLIER' });

        await pricing.saveScopedRule({ ...m(10), scope: 'NCM', scopeKey: '8421' }); // NCM do item: 84213100
        // 23,20 ÷ (1 − (10 + 7)%) = 27,95 → 28,90
        expect(await row(inv.id)).toMatchObject({ suggested: '28.9', ruleScope: 'NCM' });

        await pricing.saveScopedRule({ ...m(30), scope: 'PART', scopeKey: p.sku });
        // 23,20 ÷ (1 − (30 + 7)%) = 36,83 → 36,90
        expect(await row(inv.id)).toMatchObject({ suggested: '36.9', ruleScope: 'PART' });

        const list = (await pricing.listRules()).rules;
        expect(list.map((r) => r.scope).sort()).toEqual(['DEFAULT', 'NCM', 'PART', 'SUPPLIER']);
        expect(list.find((r) => r.scope === 'PART')?.target).toContain('ITEST-FILT');

        // apagar a exceção devolve a anterior
        await pricing.deleteRule(list.find((r) => r.scope === 'PART')!.id);
        expect(await row(inv.id)).toMatchObject({ suggested: '28.9', ruleScope: 'NCM' });
      });

      it('regra do mesmo escopo e chave é atualizada, não duplicada', async () => {
        await pricing.saveRule(rule);
        await pricing.saveScopedRule({ ...m(20), scope: 'NCM', scopeKey: '8421' });
        await pricing.saveScopedRule({ ...m(25), scope: 'NCM', scopeKey: '8421' });
        const ncm = (await pricing.listRules()).rules.filter((r) => r.scope === 'NCM');
        expect(ncm).toHaveLength(1);
        expect(ncm[0]!.value).toBe('25');
      });

      it('a padrão não se apaga; chave inválida e peça inexistente são recusadas', async () => {
        await pricing.saveRule(rule);
        const def = (await pricing.listRules()).rules.find((r) => r.scope === 'DEFAULT')!;
        await expect(pricing.deleteRule(def.id)).rejects.toMatchObject({ status: 409 });
        await expect(pricing.deleteRule('nao-existe')).rejects.toMatchObject({ status: 404 });
        await expect(pricing.saveScopedRule({ ...m(20), scope: 'SUPPLIER', scopeKey: '123' })).rejects.toMatchObject({ status: 400 });
        await expect(pricing.saveScopedRule({ ...m(20), scope: 'NCM', scopeKey: 'abc' })).rejects.toMatchObject({ status: 400 });
        await expect(pricing.saveScopedRule({ ...m(20), scope: 'PART', scopeKey: 'nao-existe' })).rejects.toMatchObject({ status: 404 });
        await expect(pricing.saveScopedRule({ ...m(95), taxPctOverride: 10, scope: 'NCM', scopeKey: '8421' })).rejects.toMatchObject({ status: 400 });
      });

      it('exceção com imposto fixo vale no lugar do perfil do contador', async () => {
        const { inv } = await setup();
        await pricing.saveScopedRule({ ...m(40), taxPctOverride: 4, scope: 'SUPPLIER', scopeKey: SUPPLIER });
        const r = await row(inv.id);
        expect(r.saleTax).toMatchObject({ pct: '4', confidence: 'DEFINIDO' });
        // 23,20 ÷ (1 − 44%) = 41,43 → 41,90
        expect(r.suggested).toBe('41.9');
      });

      it('em lote: aceitar todas as sugestões grava como escolha; limpar volta às sugestões; travadas ficam de fora', async () => {
        const { p, inv } = await setup();
        const accepted = await pricing.bulk(inv.id, { action: 'ACCEPT_SUGGESTIONS' });
        expect(accepted.rows[0]).toMatchObject({ draft: '43.9', proposed: '43.9' });
        const cleared = await pricing.bulk(inv.id, { action: 'CLEAR_DRAFTS' });
        expect(cleared.rows[0]).toMatchObject({ draft: null, proposed: '43.9' });

        await pricing.setPricingMode(p.id, 'MANUAL');
        const locked = await pricing.bulk(inv.id, { action: 'ACCEPT_SUGGESTIONS' });
        expect(locked.rows[0]).toMatchObject({ draft: null, proposed: null, locked: true });
      });

      it('em lote numa nota já lançada é recusado', async () => {
        const { inv } = await setup();
        await service.confirm(inv.id, USER);
        await expect(pricing.bulk(inv.id, { action: 'ACCEPT_SUGGESTIONS' })).rejects.toMatchObject({ status: 409 });
      });

      it('histórico da peça mostra o que o lançamento com preço gravou, mais recente primeiro', async () => {
        const { p, inv } = await setup();
        expect((await pricing.history(p.id)).history).toEqual([]);
        await service.confirm(inv.id, USER, { applyPricing: true });
        const [h] = (await pricing.history(p.id)).history;
        expect(h).toMatchObject({ source: 'INVOICE', sellBefore: '40', sellAfter: '43.9', costBefore: '10', costAfter: '23.2', saleTaxPct: '7' });
        expect(h!.taxRulesVersion).toEqual(expect.any(String));
      });
    });
  });

});

describe('schemas de entrada', () => {
  it('ação do item: união discriminada com defaults seguros', () => {
    expect(ItemActionSchema.parse({ action: 'link', partId: 'p1' })).toEqual({ action: 'link', partId: 'p1', unitFactor: 1, saveMapping: true });
    expect(() => ItemActionSchema.parse({ action: 'link', partId: '' })).toThrow(/Escolha a peça/);
    expect(() => ItemActionSchema.parse({ action: 'link', partId: 'p', unitFactor: 0 })).toThrow(/maior que zero/);
    expect(() => ItemActionSchema.parse({ action: 'explode' })).toThrow();
  });
  it('cadastro de peça exige preço de venda não negativo', () => {
    expect(() => CreatePartSchema.parse({})).toThrow(/preço de venda/);
    expect(() => CreatePartSchema.parse({ sellPrice: -1 })).toThrow(/negativo/);
    expect(CreatePartSchema.parse({ sellPrice: 0 })).toMatchObject({ unitFactor: 1, saveMapping: true });
  });
  it('lista: aba padrão é "pendentes", limites de paginação', () => {
    expect(ListQuerySchema.parse({})).toMatchObject({ view: 'pending', take: 50, skip: 0 });
    expect(() => ListQuerySchema.parse({ take: 1000 })).toThrow();
    expect(() => ListQuerySchema.parse({ view: 'x' })).toThrow();
  });

});
