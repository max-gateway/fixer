import { describe, expect, it } from 'vitest';
import { ITEM_BRAKE_PAD, ITEM_CSOSN101, ITEM_ICMS00_MONOFASICO, ITEM_ICMS10_FCP, ITEM_NO_GTIN, makeAccessKey, makeProcNfe } from '../../../test/fiscal/nfe-xml.js';
import { assessNfe, parseProcNfe } from './nfe.parser.js';
import { XmlError } from './xml.js';

const TENANT = '12ABC34501DE35';

const EMPTY_TAX = {
  indTot: null, icmsKind: null, icmsCode: null, icmsBase: null, icmsRate: null, icms: null, stBase: null, stRate: null,
  icmsSt: null, fcpSt: null, stRet: null, fcpStRet: null, deson: null, creditSnRate: null, creditSn: null,
  ipiCst: null, pisCst: null, pis: null, cofinsCst: null, cofins: null, ibsCbs: null,
};

describe('parseProcNfe', () => {
  const { xml, key } = makeProcNfe();
  const nfe = parseProcNfe(xml);

  it('lê cabeçalho', () => {
    expect(nfe).toMatchObject({
      accessKey: key,
      protocolKey: key,
      protocolStatus: 100,
      model: 55,
      series: 1,
      number: 1234,
      operationType: 1,
      finality: 1,
      issuerId: '11222333000181',
      issuerName: 'AUTO PECAS DISTRIBUIDORA LTDA',
      recipientId: TENANT,
      totalAmount: '434.85',
    });
    expect(nfe.issuedAt?.toISOString()).toBe('2026-10-05T13:30:00.000Z');
  });

  it('mantém o CNPJ alfanumérico do destinatário como texto', () => {
    expect(typeof nfe.recipientId).toBe('string');
    expect(nfe.recipientId).toBe('12ABC34501DE35');
  });

  it('lê os itens com valores decimais exatamente como no XML', () => {
    expect(nfe.items).toHaveLength(2);
    expect(nfe.items[0]).toEqual({
      itemNumber: 1,
      supplierCode: 'PAST-001',
      ean: '7891234567895',
      description: 'PASTILHA DE FREIO DIANTEIRA',
      ncm: '87083090',
      cest: '0107500',
      origin: 0,
      cfop: '5102',
      unit: 'CX',
      quantity: '2.0000',
      unitPrice: '41.9000',
      totalPrice: '83.80',
      discount: '3.00',
      freight: '6.05',
      insurance: '0',
      otherCosts: '0',
      ipi: '1.10',
      icmsSt: '4.20',
      tax: { ...EMPTY_TAX, indTot: 1, icmsKind: 'CSOSN', icmsCode: '201', icmsSt: '4.20', ipiCst: '50' },
    });
  });

  it('SEM GTIN vira null; ICMS60 só traz ST retido, que não entra no custo', () => {
    expect(nfe.items[1]).toMatchObject({ ean: null, cest: null, origin: 1, icmsSt: '0', ipi: '0' });
  });

  describe('GTIN do item', () => {
    const item = (cEAN: string, cEANTrib: string, uTrib: string, qTrib: string) =>
      parseProcNfe(
        makeProcNfe({
          items: [
            ITEM_BRAKE_PAD.replace('<cEAN>7891234567895</cEAN>', `<cEAN>${cEAN}</cEAN>`)
              .replace('<cEANTrib>7891234567895</cEANTrib><uTrib>CX</uTrib>', `<cEANTrib>${cEANTrib}</cEANTrib><uTrib>${uTrib}</uTrib>`)
              .replace('<qTrib>2.0000</qTrib>', `<qTrib>${qTrib}</qTrib>`),
          ],
        }).xml,
      ).items[0]!.ean;

    it('usa o cEAN (unidade comercial)', () => {
      expect(item('7891234567895', '7899999999991', 'UN', '8.0000')).toBe('7891234567895');
    });
    it('sem cEAN, usa o cEANTrib só se a unidade tributável é a mesma da comercial', () => {
      expect(item('SEM GTIN', '7899999999991', 'CX', '2.0000')).toBe('7899999999991');
    });
    it('sem cEAN e com unidade/quantidade tributável diferente, não casa por GTIN (erraria a quantidade)', () => {
      expect(item('SEM GTIN', '7899999999991', 'UN', '8.0000')).toBeNull();
    });
  });

  it('aceita NFe sem o envelope nfeProc', () => {
    const bare = xml.replace(/<\/?nfeProc[^>]*>/g, '').replace(/<protNFe[\s\S]*<\/protNFe>/, '');
    const parsed = parseProcNfe(bare);
    expect(parsed.accessKey).toBe(key);
    expect(parsed.protocolStatus).toBeNull();
  });

  it('uma nota com um único item continua sendo lista', () => {
    expect(parseProcNfe(makeProcNfe({ items: [ITEM_BRAKE_PAD] }).xml).items).toHaveLength(1);
  });

  it('recusa DTD/entidades (XXE, billion laughs)', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]>${xml}`;
    expect(() => parseProcNfe(evil)).toThrow(XmlError);
  });

  it('recusa XML sem infNFe', () => {
    expect(() => parseProcNfe('<nfeProc><NFe/></nfeProc>')).toThrow(/infNFe/);
  });
});

describe('assessNfe', () => {
  const parse = (o = {}) => parseProcNfe(makeProcNfe(o).xml);

  it('aceita compra autorizada para o tenant', () => {
    expect(assessNfe(parse(), TENANT)).toEqual({ ok: true, needsReview: false });
  });

  it('finalidade diferente de 1 passa, mas exige revisão', () => {
    expect(assessNfe(parse({ finNFe: 4 }), TENANT)).toEqual({ ok: true, needsReview: true });
  });

  it('destinatário diferente do tenant', () => {
    expect(assessNfe(parse({ recipient: '11222333000181' }), TENANT)).toEqual({ ok: false, reason: 'NOT_RECIPIENT' });
  });

  it('outro estabelecimento da mesma raiz não é compra deste tenant', () => {
    // Mesma raiz 12ABC345, filial 0002 (DV recalculado não importa para esta regra).
    expect(assessNfe(parse({ recipient: '12ABC34500020X'.slice(0, 14) }), TENANT)).toMatchObject({ ok: false, reason: 'NOT_RECIPIENT' });
  });

  it('nota de saída do tenant (tpNF 0) não é compra', () => {
    expect(assessNfe(parse({ tpNF: 0 }), TENANT)).toEqual({ ok: false, reason: 'NOT_INBOUND' });
  });

  it('não autorizada (denegada/cancelada no protocolo)', () => {
    expect(assessNfe(parse({ cStat: 110 }), TENANT)).toEqual({ ok: false, reason: 'NOT_AUTHORIZED' });
  });

  it('chave com dígito verificador inválido', () => {
    const key = makeAccessKey('11222333000181').slice(0, 43) + '0';
    const bad = key === makeAccessKey('11222333000181') ? makeAccessKey('11222333000181').slice(0, 43) + '1' : key;
    expect(assessNfe(parse({ key: bad }), TENANT)).toEqual({ ok: false, reason: 'INVALID_KEY' });
  });

  it('chave que não pertence ao emitente declarado', () => {
    const foreign = makeAccessKey('10588201000105');
    expect(assessNfe(parse({ key: foreign }), TENANT)).toEqual({ ok: false, reason: 'KEY_MISMATCH' });
  });

  it('nota sem itens', () => {
    expect(assessNfe(parse({ items: [] }), TENANT)).toEqual({ ok: false, reason: 'NO_ITEMS' });
  });
});

describe('captura tributária (docs/specs/pricing.md §4.0)', () => {
  it('cabeçalho: CRT, UFs, idDest, modFrete e os totais que o custo usa', () => {
    const { xml } = makeProcNfe({
      issuerCrt: 3,
      issuerUf: 'MG',
      recipientUf: 'SP',
      idDest: 2,
      modFrete: 1,
      icmsTot: '<vProd>425.80</vProd><vFrete>12.00</vFrete><vDesc>3.00</vDesc><vFCPST>5.60</vFCPST><vNF>434.85</vNF>',
    });
    const nfe = parseProcNfe(xml);
    expect(nfe).toMatchObject({ issuerCrt: 3, issuerUf: 'MG', recipientUf: 'SP', destIndicator: 2, freightMode: 1 });
    expect(nfe.totals).toEqual({ vProd: '425.80', vFrete: '12.00', vDesc: '3.00', vFCPST: '5.60' });
  });

  it('nota sem os campos não quebra: tudo null e totais vazios', () => {
    const { xml } = makeProcNfe();
    const bare = xml.replace(/<enderEmit>.*?<\/enderEmit><CRT>\d<\/CRT>/, '').replace(/<enderDest>.*?<\/enderDest>/, '').replace(/<transp>.*?<\/transp>/, '').replace(/<idDest>\d<\/idDest>/, '');
    expect(parseProcNfe(bare)).toMatchObject({ issuerCrt: null, issuerUf: null, recipientUf: null, destIndicator: null, freightMode: null });
  });

  it('ICMS10: ICMS próprio, ST e FCP-ST (que o custo antigo não via), PIS/COFINS tributados e IBSCBS cru', () => {
    const [item] = parseProcNfe(makeProcNfe({ items: [ITEM_ICMS10_FCP] }).xml).items;
    expect(item!.tax).toEqual({
      ...EMPTY_TAX,
      indTot: 1,
      icmsKind: 'CST',
      icmsCode: '10',
      icmsBase: '200.00',
      icmsRate: '12.00',
      icms: '24.00',
      stBase: '280.00',
      stRate: '18.00',
      icmsSt: '26.40',
      fcpSt: '5.60',
      pisCst: '01',
      pis: '1.30',
      cofinsCst: '01',
      cofins: '6.00',
      ibsCbs: { CST: '000', cClassTrib: '000001' },
    });
    expect(item!.icmsSt).toBe('26.40');
  });

  it('ICMS00 com PIS/COFINS monofásicos (CST 04) e IPI não tributado', () => {
    const [item] = parseProcNfe(makeProcNfe({ items: [ITEM_ICMS00_MONOFASICO] }).xml).items;
    expect(item!.tax).toMatchObject({ icmsKind: 'CST', icmsCode: '00', icms: '108.00', ipiCst: '53', pisCst: '04', pis: null, cofinsCst: '04', ibsCbs: null });
  });

  it('CSOSN 101 (emitente Simples): crédito que o comprador do regime normal pode aproveitar', () => {
    const [item] = parseProcNfe(makeProcNfe({ items: [ITEM_CSOSN101] }).xml).items;
    expect(item!.tax).toMatchObject({ icmsKind: 'CSOSN', icmsCode: '101', creditSnRate: '1.25', creditSn: '1.25', icms: null });
  });

  it('ICMS60: ST retido antes fica em stRet e não vira icmsSt', () => {
    const [, item] = parseProcNfe(makeProcNfe({ items: [ITEM_BRAKE_PAD, ITEM_NO_GTIN] }).xml).items;
    expect(item!.tax).toMatchObject({ icmsKind: 'CST', icmsCode: '60', stRet: '9.99', icmsSt: null });
  });

  it('valores ficam como string do XML, sem Number', () => {
    const [item] = parseProcNfe(makeProcNfe({ items: [ITEM_ICMS10_FCP] }).xml).items;
    const { indTot, ...rest } = item!.tax; // indTot é um indicador (0/1), não um valor
    expect(indTot).toBe(1);
    for (const v of Object.values(rest)) expect(typeof v === 'number').toBe(false);
  });
});
