import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FakePrisma } from '../../../test/fiscal/fake-prisma.js';
import { BILLING_3X, ITEM_BRAKE_PAD, makeAccessKey, makeEvent, makeProcNfe, makeResNfe } from '../../../test/fiscal/nfe-xml.js';
import type { DistDocument } from '../parser/dist-response.parser.js';
import { processBatch } from './batch.processor.js';

const TENANT = '12ABC34501DE35';
const ISSUER = '11222333000181';
const now = new Date('2026-10-11T12:00:00Z');

const proc = (xml: string, nsu: bigint | null = 1n): DistDocument => ({ nsu, schema: 'procNFe_v4.00.xsd', xml });
const res = (xml: string, nsu: bigint | null = 1n): DistDocument => ({ nsu, schema: 'resNFe_v1.00.xsd', xml });
const event = (key: string, o: Parameters<typeof makeEvent>[1] = {}, nsu: bigint | null = 1n): DistDocument => ({
  nsu,
  ...makeEvent(key, o),
});

function run(db: FakePrisma, docs: DistDocument[]) {
  return processBatch(db as never, docs, { tenantCnpj: TENANT, now });
}

describe('processBatch: resumo (resNFe)', () => {
  it('cria SUMMARY; repetir é no-op', async () => {
    const db = new FakePrisma();
    const key = makeAccessKey(ISSUER);
    expect(await run(db, [res(makeResNfe(key))])).toMatchObject({ summaries: 1 });
    expect(await run(db, [res(makeResNfe(key))])).toMatchObject({ summaries: 0 });
    expect(db.invoices.size).toBe(1);
    expect(db.invoice(key)).toMatchObject({ status: 'SUMMARY', exportStatus: 'NOT_READY', issuerCnpj: ISSUER, totalAmount: '434.85' });
  });

  it('o resumo não traz destinatário nem itens', async () => {
    const db = new FakePrisma();
    const key = makeAccessKey(ISSUER);
    await run(db, [res(makeResNfe(key))]);
    expect(db.invoice(key).recipientCnpj).toBeUndefined();
    expect(db.items).toHaveLength(0);
  });

  it('resumo atrasado nunca rebaixa uma nota FULL', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe();
    await run(db, [proc(xml)]);
    await run(db, [res(makeResNfe(key))]);
    expect(db.invoice(key).status).toBe('FULL');
  });

  it('situação cancelada vira CANCELED/VOIDED; denegada e emitida por nós viram IGNORED', async () => {
    const db = new FakePrisma();
    const k1 = makeAccessKey(ISSUER, 1);
    const k2 = makeAccessKey(ISSUER, 2);
    const k3 = makeAccessKey(TENANT, 3);
    const c = await run(db, [
      res(makeResNfe(k1, { situation: 3 })),
      res(makeResNfe(k2, { situation: 2 })),
      res(makeResNfe(k3, { issuer: TENANT })),
    ]);
    expect(db.invoice(k1)).toMatchObject({ status: 'CANCELED', exportStatus: 'VOIDED' });
    expect(db.invoice(k2)).toMatchObject({ status: 'IGNORED', ignoredReason: 'NOT_AUTHORIZED' });
    expect(db.invoice(k3)).toMatchObject({ status: 'IGNORED', ignoredReason: 'ISSUED_BY_TENANT' });
    expect(c).toMatchObject({ canceled: 1, ignored: 2 });
  });

  it('chave malformada ou XML ilegível: conta como inválido e não cria nada', async () => {
    const db = new FakePrisma();
    const c = await run(db, [res('<resNFe><chNFe>123</chNFe></resNFe>'), res('<nada/>'), res('<<<')]);
    expect(c.invalid).toBe(3);
    expect(db.invoices.size).toBe(0);
  });
});

describe('processBatch: nota completa (procNFe)', () => {
  it('grava cabeçalho, XML original (gzip + sha256) e itens; fica pendente de vínculo', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe();
    expect(await run(db, [proc(xml, 7n)])).toMatchObject({ full: 1 });

    const inv = db.invoice(key);
    expect(inv).toMatchObject({
      status: 'FULL',
      exportStatus: 'PENDING_MATCH',
      needsReview: false,
      nsu: 7n,
      issuerCnpj: ISSUER,
      recipientCnpj: TENANT,
      totalAmount: '434.85',
      number: 1234,
      series: 1,
    });
    expect(gunzipSync(inv.xmlGz).toString('utf8')).toBe(xml);
    expect(inv.xmlSha256).toBe(createHash('sha256').update(xml).digest('hex'));
    const items = db.itemsOf(key);
    expect(items.map((i) => i.itemNumber)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ supplierCode: 'PAST-001', ean: '7891234567895', quantity: '2.0000', icmsSt: '4.20' });
    // Sem vínculo aprendido nem peça com o GTIN, tudo fica para conciliação.
    expect(items.map((i) => i.resolution)).toEqual(['UNRESOLVED', 'UNRESOLVED']);
  });

  it('completa uma nota que já era SUMMARY ou MANIFESTED', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe();
    await run(db, [res(makeResNfe(key))]);
    db.invoice(key).status = 'MANIFESTED';
    await run(db, [proc(xml)]);
    expect(db.invoices.size).toBe(1);
    expect(db.invoice(key).status).toBe('FULL');
    expect(db.itemsOf(key)).toHaveLength(2);
  });

  it('procNFe repetido é no-op: não duplica itens nem sobrescreve o estado de estoque', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe();
    await run(db, [proc(xml)]);
    db.invoice(key).exportStatus = 'POSTED';
    expect(await run(db, [proc(xml)])).toMatchObject({ full: 0 });
    expect(db.itemsOf(key)).toHaveLength(2);
    expect(db.invoice(key).exportStatus).toBe('POSTED');
  });

  it('finalidade ≠ 1 passa, mas exige revisão', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe({ finNFe: 4 });
    await run(db, [proc(xml)]);
    expect(db.invoice(key)).toMatchObject({ status: 'FULL', needsReview: true, finality: 4 });
  });

  it('destinatário diferente: IGNORED, sem itens, mas o XML é guardado (guarda fiscal)', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe({ recipient: '10588201000105' });
    const c = await run(db, [proc(xml)]);
    expect(db.invoice(key)).toMatchObject({ status: 'IGNORED', ignoredReason: 'NOT_RECIPIENT', exportStatus: 'NOT_READY' });
    expect(db.invoice(key).xmlGz).toBeInstanceOf(Buffer);
    expect(db.items).toHaveLength(0);
    expect(c.ignored).toBe(1);
  });

  it('não autorizada e saída nossa viram IGNORED com o motivo', async () => {
    const db = new FakePrisma();
    const a = makeProcNfe({ cStat: 110, number: 1 });
    const b = makeProcNfe({ tpNF: 0, number: 2 });
    await run(db, [proc(a.xml), proc(b.xml)]);
    expect(db.invoice(a.key).ignoredReason).toBe('NOT_AUTHORIZED');
    expect(db.invoice(b.key).ignoredReason).toBe('NOT_INBOUND');
  });

  it('chave inválida: nada é gravado (sem chave não há como identificar)', async () => {
    const db = new FakePrisma();
    const good = makeAccessKey(ISSUER);
    const bad = good.slice(0, 43) + (good.endsWith('0') ? '1' : '0');
    const c = await run(db, [proc(makeProcNfe({ key: bad }).xml)]);
    expect(c.invalid).toBe(1);
    expect(db.invoices.size).toBe(0);
  });

  it('item com número duplicado ou valor fora do formato não derruba o lote: nota IGNORED', async () => {
    const db = new FakePrisma();
    const dup = makeProcNfe({ number: 1, items: [ITEM_BRAKE_PAD, ITEM_BRAKE_PAD] });
    const badNum = makeProcNfe({ number: 2, items: [ITEM_BRAKE_PAD.replace('<qCom>2.0000</qCom>', '<qCom>2,0000</qCom>')] });
    const ok = makeProcNfe({ number: 3 });
    const c = await run(db, [proc(dup.xml), proc(badNum.xml), proc(ok.xml)]);
    expect(db.invoice(dup.key)).toMatchObject({ status: 'IGNORED', ignoredReason: 'INVALID_ITEMS' });
    expect(db.invoice(badNum.key)).toMatchObject({ status: 'IGNORED', ignoredReason: 'INVALID_ITEMS' });
    expect(db.invoice(ok.key).status).toBe('FULL');
    expect(c).toMatchObject({ full: 1, invalid: 2 });
  });

  it('lote misto na ordem da SEFAZ: resumo, completo, evento', async () => {
    const db = new FakePrisma();
    const a = makeProcNfe({ number: 1 });
    const b = makeProcNfe({ number: 2 });
    const c = await run(db, [res(makeResNfe(a.key), 1n), proc(a.xml, 2n), proc(b.xml, 3n), event(a.key, {}, 4n)]);
    expect(c).toMatchObject({ summaries: 1, full: 2, canceled: 1 });
    expect(db.invoice(a.key).status).toBe('CANCELED');
    expect(db.invoice(b.key).status).toBe('FULL');
  });
});

describe('processBatch: cancelamento', () => {
  it('cancela nota ainda não lançada: CANCELED e VOIDED', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe();
    await run(db, [proc(xml)]);
    const c = await run(db, [event(key)]);
    expect(db.invoice(key)).toMatchObject({ status: 'CANCELED', exportStatus: 'VOIDED', canceledAt: now });
    expect(c).toMatchObject({ canceled: 1, canceledAfterPosting: 0 });
  });

  it('cancelamento de nota já lançada: mantém POSTED e sinaliza para estorno manual', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe();
    await run(db, [proc(xml)]);
    db.invoice(key).exportStatus = 'POSTED';
    const c = await run(db, [event(key)]);
    expect(db.invoice(key)).toMatchObject({ status: 'CANCELED', exportStatus: 'POSTED' });
    expect(c.canceledAfterPosting).toBe(1);
  });

  it('cancelamento chega antes da nota: registro mínimo; a nota que vier depois continua cancelada', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe();
    await run(db, [event(key, { full: false })]);
    expect(db.invoice(key)).toMatchObject({ status: 'CANCELED', exportStatus: 'VOIDED', issuerCnpj: ISSUER });

    await run(db, [proc(xml)]);
    expect(db.invoice(key).status).toBe('CANCELED');
    expect(db.itemsOf(key)).toHaveLength(0);
  });

  it('cancelar duas vezes é idempotente', async () => {
    const db = new FakePrisma();
    const { key } = makeProcNfe();
    await run(db, [event(key)]);
    expect(await run(db, [event(key)])).toMatchObject({ canceled: 0 });
  });

  it('evento não efetivo (136, não vinculado) e outros eventos (210210, carta de correção) são ignorados', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe();
    await run(db, [proc(xml)]);
    const c = await run(db, [event(key, { status: 136 }), event(key, { type: '210210' }), event(key, { type: '110110' })]);
    expect(c).toMatchObject({ skipped: 3, canceled: 0 });
    expect(db.invoice(key).status).toBe('FULL');
  });
});

describe('processBatch: documentos inutilizáveis', () => {
  it('docZip com erro, evento ilegível e tipos desconhecidos nunca lançam', async () => {
    const db = new FakePrisma();
    const c = await run(db, [
      { nsu: 1n, schema: 'procNFe_v4.00.xsd', xml: '', error: 'docZip inválido' },
      { nsu: 2n, schema: 'resEvento_v1.01.xsd', xml: '<resEvento/>' },
      { nsu: 3n, schema: 'procCTe_v3.00.xsd', xml: '<x/>' },
      { nsu: 4n, schema: 'procNFe_v4.00.xsd', xml: '<!DOCTYPE a [<!ENTITY x "y">]><nfeProc/>' },
    ]);
    expect(c).toMatchObject({ invalid: 3, skipped: 1 });
    expect(db.invoices.size).toBe(0);
  });
});

describe('processBatch: conciliação automática dos itens', () => {
  const PAD = { supplierCode: 'PAST-001', ean: '7891234567895' };

  it('vínculo aprendido do fornecedor resolve o item e herda o fator de unidade', async () => {
    const db = new FakePrisma();
    db.maps.push({ id: 'm1', supplierCnpj: ISSUER, supplierCode: PAD.supplierCode, partId: 'part-1', unitFactor: '4' });
    const { xml, key } = makeProcNfe();
    const c = await run(db, [proc(xml)]);
    const [pad, oil] = db.itemsOf(key);
    expect(pad).toMatchObject({ resolution: 'AUTO_MAP', partId: 'part-1', unitFactor: '4' });
    expect(oil).toMatchObject({ resolution: 'UNRESOLVED', partId: null });
    expect(c.autoResolved).toBe(1);
    expect(db.invoice(key).exportStatus).toBe('PENDING_MATCH'); // o óleo ainda não tem vínculo
  });

  it('GTIN de uma única peça resolve e aprende o vínculo para a próxima nota', async () => {
    const db = new FakePrisma();
    db.parts.push({ id: 'part-9', ean: PAD.ean });
    const a = makeProcNfe({ number: 1 });
    await run(db, [proc(a.xml)]);
    expect(db.itemsOf(a.key)[0]).toMatchObject({ resolution: 'AUTO_EAN', partId: 'part-9', unitFactor: '1' });
    expect(db.maps).toEqual([expect.objectContaining({ supplierCnpj: ISSUER, supplierCode: PAD.supplierCode, partId: 'part-9' })]);

    // Mesmo sem a peça ter o GTIN cadastrado, a segunda nota já resolve pelo código do fornecedor.
    db.parts.length = 0;
    const b = makeProcNfe({ number: 2 });
    await run(db, [proc(b.xml)]);
    expect(db.itemsOf(b.key)[0]).toMatchObject({ resolution: 'AUTO_MAP', partId: 'part-9' });
  });

  it('GTIN repetido em mais de uma peça é ambíguo: fica para o usuário', async () => {
    const db = new FakePrisma();
    db.parts.push({ id: 'p1', ean: PAD.ean }, { id: 'p2', ean: PAD.ean });
    const { xml, key } = makeProcNfe();
    await run(db, [proc(xml)]);
    expect(db.itemsOf(key)[0]).toMatchObject({ resolution: 'UNRESOLVED', partId: null });
    expect(db.maps).toHaveLength(0);
  });

  it('todos os itens resolvidos e sem revisão: a nota já nasce READY', async () => {
    const db = new FakePrisma();
    db.maps.push(
      { id: 'm1', supplierCnpj: ISSUER, supplierCode: 'PAST-001', partId: 'p1', unitFactor: '1' },
      { id: 'm2', supplierCnpj: ISSUER, supplierCode: 'OLEO-5W30', partId: 'p2', unitFactor: '1' },
    );
    const { xml, key } = makeProcNfe();
    await run(db, [proc(xml)]);
    expect(db.invoice(key)).toMatchObject({ status: 'FULL', exportStatus: 'READY' });
  });

  it('com revisão pendente (finalidade ≠ 1) nunca vira READY, nem com tudo resolvido', async () => {
    const db = new FakePrisma();
    db.maps.push(
      { id: 'm1', supplierCnpj: ISSUER, supplierCode: 'PAST-001', partId: 'p1', unitFactor: '1' },
      { id: 'm2', supplierCnpj: ISSUER, supplierCode: 'OLEO-5W30', partId: 'p2', unitFactor: '1' },
    );
    const { xml, key } = makeProcNfe({ finNFe: 4 });
    await run(db, [proc(xml)]);
    expect(db.invoice(key)).toMatchObject({ exportStatus: 'PENDING_MATCH', needsReview: true });
  });

  it('o vínculo de outro fornecedor para o mesmo código não vaza', async () => {
    const db = new FakePrisma();
    db.maps.push({ id: 'm1', supplierCnpj: '10588201000105', supplierCode: 'PAST-001', partId: 'p1', unitFactor: '1' });
    const { xml, key } = makeProcNfe();
    await run(db, [proc(xml)]);
    expect(db.itemsOf(key)[0]).toMatchObject({ resolution: 'UNRESOLVED' });
  });
});

describe('processBatch: contas a pagar', () => {
  it('cria uma parcela por duplicata; reprocessar o mesmo XML não duplica', async () => {
    const db = new FakePrisma();
    const { xml } = makeProcNfe({ billing: BILLING_3X });
    expect(await run(db, [proc(xml)])).toMatchObject({ full: 1, payables: 3 });
    expect(db.payables).toHaveLength(3);
    expect(db.payables[0]).toMatchObject({ supplierCnpj: ISSUER, supplierName: 'AUTO PECAS DISTRIBUIDORA LTDA', installment: 1, amount: '144.95' });

    expect(await run(db, [proc(xml)])).toMatchObject({ full: 0, payables: 0 });
    expect(db.payables).toHaveLength(3);
  });

  it('nota ignorada (não somos o destinatário) não gera conta a pagar', async () => {
    const db = new FakePrisma();
    const { xml } = makeProcNfe({ billing: BILLING_3X, recipient: '99888777000166' });
    await run(db, [proc(xml)]);
    expect(db.payables).toHaveLength(0);
  });

  it('o cancelamento cancela só as parcelas em aberto; a já paga fica', async () => {
    const db = new FakePrisma();
    const { xml, key } = makeProcNfe({ billing: BILLING_3X });
    await run(db, [proc(xml)]);
    db.payables[0]!.status = 'PAID';
    await run(db, [event(key)]);
    expect(db.payables.map((p) => p.status)).toEqual(['PAID', 'CANCELED', 'CANCELED']);
  });
});
