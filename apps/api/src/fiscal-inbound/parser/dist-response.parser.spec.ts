import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NT_SAMPLE_ACCESS_KEY, NT_SAMPLE_DOCZIP_B64, NT_SAMPLE_RES_NFE_XML } from '../../../test/fiscal/nt-sample.js';
import { makeDistResponse, makeProcNfe } from '../../../test/fiscal/nfe-xml.js';
import { parseDistResponse, schemaKind } from './dist-response.parser.js';
import { MAX_XML_BYTES, parseXml, XmlError } from './xml.js';

describe('parseDistResponse', () => {
  it('lê a resposta oficial da NT (cStat 138, docZip real em gzip/base64)', () => {
    const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
      <nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>
      <retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1.4.0</verAplic>
      <cStat>138</cStat><xMotivo>Documento(s) localizado(s)</xMotivo><dhResp>2022-04-04T11:54:49-03:00</dhResp>
      <ultNSU>000000000000200</ultNSU><maxNSU>000000000000200</maxNSU>
      <loteDistDFeInt><docZip NSU="000000000000200" schema="resNFe_v1.00.xsd">${NT_SAMPLE_DOCZIP_B64}</docZip></loteDistDFeInt>
      </retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`;
    const res = parseDistResponse(xml);
    expect(res).toMatchObject({ tpAmb: 1, cStat: 138, ultNsu: 200n, maxNsu: 200n });
    expect(res.documents).toHaveLength(1);
    const [doc] = res.documents;
    expect(doc).toMatchObject({ nsu: 200n, schema: 'resNFe_v1.00.xsd', xml: NT_SAMPLE_RES_NFE_XML });
    expect(doc!.xml).toContain(NT_SAMPLE_ACCESS_KEY);
  });

  it('137: sem lote de documentos', () => {
    const res = parseDistResponse(makeDistResponse({ cStat: 137, xMotivo: 'Nenhum documento localizado', ultNSU: '0', maxNSU: '0' }));
    expect(res).toMatchObject({ cStat: 137, ultNsu: 0n, maxNsu: 0n, documents: [] });
  });

  it('656: devolve o ultNSU da rejeição para diagnóstico', () => {
    const res = parseDistResponse(makeDistResponse({ cStat: 656, xMotivo: 'Rejeicao: Consumo Indevido', ultNSU: '12345' }));
    expect(res).toMatchObject({ cStat: 656, ultNsu: 12345n, maxNsu: null });
  });

  it('NSU por documento é facultativo (NT v1.15): ausente vira null', () => {
    const { xml } = makeProcNfe();
    const res = parseDistResponse(
      makeDistResponse({ cStat: 138, ultNSU: '77', maxNSU: '77', docs: [{ schema: 'procNFe_v4.00.xsd', xml }] }),
    );
    expect(res.documents[0]).toMatchObject({ nsu: null, schema: 'procNFe_v4.00.xsd', xml });
  });

  it('vários documentos mantêm a ordem do lote', () => {
    const a = makeProcNfe({ number: 1 }).xml;
    const b = makeProcNfe({ number: 2 }).xml;
    const res = parseDistResponse(
      makeDistResponse({
        cStat: 138,
        ultNSU: '2',
        maxNSU: '9',
        docs: [
          { nsu: '1', schema: 'procNFe_v4.00.xsd', xml: a },
          { nsu: '2', schema: 'procNFe_v4.00.xsd', xml: b },
        ],
      }),
    );
    expect(res.documents.map((d) => d.nsu)).toEqual([1n, 2n]);
    expect(res.documents.map((d) => d.xml)).toEqual([a, b]);
    expect(res.maxNsu).toBe(9n);
  });

  it('docZip corrompido não derruba o lote', () => {
    const good = makeProcNfe().xml;
    const raw = makeDistResponse({ cStat: 138, ultNSU: '2', maxNSU: '2', docs: [{ nsu: '2', schema: 'procNFe_v4.00.xsd', xml: good }] });
    const broken = raw.replace('<loteDistDFeInt>', '<loteDistDFeInt><docZip NSU="1" schema="resNFe_v1.00.xsd">bGl4bw==</docZip>');
    const res = parseDistResponse(broken);
    expect(res.documents[0]).toMatchObject({ nsu: 1n, xml: '', error: expect.any(String) });
    expect(res.documents[1]).toMatchObject({ nsu: 2n, xml: good });
  });

  it('zip bomb: descompressão acima do teto vira erro do documento', () => {
    const bomb = gzipSync(Buffer.alloc(MAX_XML_BYTES + 1024, 'a')).toString('base64');
    const xml = makeDistResponse({ cStat: 138, ultNSU: '1', maxNSU: '1' }).replace(
      '</retDistDFeInt>',
      `<loteDistDFeInt><docZip NSU="1" schema="procNFe_v4.00.xsd">${bomb}</docZip></loteDistDFeInt></retDistDFeInt>`,
    );
    const [doc] = parseDistResponse(xml).documents;
    expect(doc).toMatchObject({ xml: '', error: expect.stringMatching(/grande demais/) });
  });

  it('resposta sem retDistDFeInt ou sem cStat é erro', () => {
    expect(() => parseDistResponse('<soap:Envelope xmlns:soap="x"><soap:Body/></soap:Envelope>')).toThrow(XmlError);
    expect(() => parseDistResponse('<retDistDFeInt><xMotivo>x</xMotivo></retDistDFeInt>')).toThrow(/cStat/);
  });

  it('recusa DTD na resposta', () => {
    expect(() => parseDistResponse('<!DOCTYPE a [<!ENTITY x "y">]><retDistDFeInt><cStat>138</cStat></retDistDFeInt>')).toThrow(XmlError);
  });
});

describe('schemaKind', () => {
  it('casa pelo prefixo, ignorando a versão', () => {
    expect(schemaKind('resNFe_v1.00.xsd')).toBe('resNFe');
    expect(schemaKind('resNFe_v1.01.xsd')).toBe('resNFe');
    expect(schemaKind('procNFe_v4.00.xsd')).toBe('procNFe');
    expect(schemaKind('resEvento_v1.00.xsd')).toBe('resEvento');
    expect(schemaKind('procEventoNFe_v1.00.xsd')).toBe('procEventoNFe');
    expect(schemaKind('procCTe_v3.00.xsd')).toBe('other');
    expect(schemaKind('')).toBe('other');
  });
});

describe('parseXml', () => {
  it('nunca converte CNPJ, chave ou NSU em número', () => {
    const parsed = parseXml('<a><CNPJ>00123456000190</CNPJ><n>0001</n></a>');
    expect(parsed.a.CNPJ).toBe('00123456000190');
    expect(parsed.a.n).toBe('0001');
  });
});
