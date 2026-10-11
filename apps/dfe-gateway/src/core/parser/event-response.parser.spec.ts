import { describe, expect, it } from 'vitest';
import { parseEnvEventoResponse } from './event-response.parser.js';
import { XmlError } from './xml.js';

const wrap = (inner: string) =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${inner}</nfeResultMsg></soap:Body></soap:Envelope>`;

const ret = (cStat: number, key: string, extra = '') =>
  `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>AN_1.0</verAplic><cOrgao>91</cOrgao><cStat>${cStat}</cStat>` +
  `<xMotivo>motivo ${cStat}</xMotivo><chNFe>${key}</chNFe><tpEvento>210210</tpEvento><xEvento>Ciencia da Operacao registrada</xEvento>` +
  `<nSeqEvento>1</nSeqEvento><CNPJDest>12ABC34501DE35</CNPJDest><dhRegEvento>2026-10-11T12:00:00-03:00</dhRegEvento>${extra}</infEvento></retEvento>`;

const K1 = 'A'.repeat(43) + '1';
const K2 = 'B'.repeat(43) + '2';

describe('parseEnvEventoResponse', () => {
  it('lote processado (128) com o resultado de cada evento', () => {
    const xml = wrap(
      `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>AN</verAplic>` +
        `<cOrgao>91</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>${ret(135, K1, '<nProt>891260000000123</nProt>')}${ret(573, K2)}</retEnvEvento>`,
    );
    expect(parseEnvEventoResponse(xml)).toEqual({
      batchStatus: 128,
      batchMotivo: 'Lote de Evento Processado',
      events: [
        { accessKey: K1, cStat: 135, xMotivo: 'motivo 135', protocol: '891260000000123' },
        { accessKey: K2, cStat: 573, xMotivo: 'motivo 573', protocol: null },
      ],
    });
  });

  it('um único retEvento também vira lista', () => {
    const xml = wrap(`<retEnvEvento versao="1.00"><cStat>128</cStat><xMotivo>ok</xMotivo>${ret(135, K1)}</retEnvEvento>`);
    expect(parseEnvEventoResponse(xml).events).toHaveLength(1);
  });

  it('lote rejeitado: sem eventos individuais', () => {
    const res = parseEnvEventoResponse(wrap('<retEnvEvento versao="1.00"><cStat>215</cStat><xMotivo>Rejeicao: Falha Schema XML</xMotivo></retEnvEvento>'));
    expect(res).toEqual({ batchStatus: 215, batchMotivo: 'Rejeicao: Falha Schema XML', events: [] });
  });

  it('cStat do evento ausente vira 0 (nunca é confundido com sucesso)', () => {
    const xml = wrap(`<retEnvEvento><cStat>128</cStat><xMotivo>x</xMotivo><retEvento><infEvento><chNFe>${K1}</chNFe></infEvento></retEvento></retEnvEvento>`);
    expect(parseEnvEventoResponse(xml).events[0]).toMatchObject({ cStat: 0 });
  });

  it('resposta sem retEnvEvento, sem cStat ou com DTD é erro', () => {
    expect(() => parseEnvEventoResponse('<html>erro</html>')).toThrow(XmlError);
    expect(() => parseEnvEventoResponse('<retEnvEvento><xMotivo>x</xMotivo></retEnvEvento>')).toThrow(/cStat/);
    expect(() => parseEnvEventoResponse('<!DOCTYPE a [<!ENTITY x "y">]><retEnvEvento><cStat>128</cStat></retEnvEvento>')).toThrow(XmlError);
  });
});
