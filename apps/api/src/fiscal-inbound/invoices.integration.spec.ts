import { TEST_ORG } from '../../test/setup.js';
import { tenantClient } from '../../test/db.js';
import { PrismaClient } from '@fixer/db';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ITEM_BRAKE_PAD, makeDistResponse, makeProcNfe } from '../../test/fiscal/nfe-xml.js';
import { CreatePartSchema, InvoicesService, ItemActionSchema, ListQuerySchema } from './invoices.service.js';
import { parseDistResponse } from './parser/dist-response.parser.js';
import { SyncRunner } from './sync/sync.runner.js';

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
    await db.supplierItemMap.deleteMany({ where: { supplierCnpj: SUPPLIER } });
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
    await db.tenantFiscalSettings.upsert({ where: { orgId: TEST_ORG }, create: { orgId: TEST_ORG, cnpj: TENANT, ufCode: 35 }, update: { cnpj: TENANT, ufCode: 35 } });
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
