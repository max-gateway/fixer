import { gzipSync } from 'node:zlib';
import { accessKeyCheckDigit } from '../../src/fiscal-inbound/cnpj.js';

export function makeAccessKey(issuerCnpj: string, number = 1234): string {
  const first43 =
    '35' + '2610' + issuerCnpj + '55' + '001' + String(number).padStart(9, '0') + '1' + '12345678';
  return first43 + accessKeyCheckDigit(first43);
}

export interface NfeOptions {
  issuer?: string;
  recipient?: string;
  tpNF?: number;
  finNFe?: number;
  cStat?: number;
  number?: number;
  items?: string[];
  key?: string;
}

/** Item no formato do procNFe 4.00: Simples Nacional, com ST cobrado na nota (ICMSSN201). */
export const ITEM_BRAKE_PAD = `
  <det nItem="1">
    <prod>
      <cProd>PAST-001</cProd><cEAN>7891234567895</cEAN><xProd>PASTILHA DE FREIO DIANTEIRA</xProd>
      <NCM>87083090</NCM><CEST>0107500</CEST><CFOP>5102</CFOP><uCom>CX</uCom><qCom>2.0000</qCom>
      <vUnCom>41.9000</vUnCom><vProd>83.80</vProd><cEANTrib>7891234567895</cEANTrib><uTrib>CX</uTrib>
      <qTrib>2.0000</qTrib><vUnTrib>41.9000</vUnTrib><vFrete>6.05</vFrete><vDesc>3.00</vDesc><indTot>1</indTot>
    </prod>
    <imposto>
      <ICMS><ICMSSN201><orig>0</orig><CSOSN>201</CSOSN><vICMSST>4.20</vICMSST></ICMSSN201></ICMS>
      <IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vIPI>1.10</vIPI></IPITrib></IPI>
    </imposto>
  </det>`;

export const ITEM_NO_GTIN = `
  <det nItem="2">
    <prod>
      <cProd>OLEO-5W30</cProd><cEAN>SEM GTIN</cEAN><xProd>OLEO 5W30 SINTETICO 1L</xProd>
      <NCM>27101932</NCM><CFOP>5405</CFOP><uCom>UN</uCom><qCom>12.0000</qCom>
      <vUnCom>28.5000</vUnCom><vProd>342.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib>
      <qTrib>12.0000</qTrib><vUnTrib>28.5000</vUnTrib><indTot>1</indTot>
    </prod>
    <imposto><ICMS><ICMS60><orig>1</orig><CST>60</CST><vICMSSTRet>9.99</vICMSSTRet></ICMS60></ICMS></imposto>
  </det>`;

export function makeProcNfe(opts: NfeOptions = {}): { xml: string; key: string } {
  const issuer = opts.issuer ?? '11222333000181';
  const key = opts.key ?? makeAccessKey(issuer, opts.number ?? 1234);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${key}" versao="4.00">
      <ide>
        <cUF>35</cUF><mod>55</mod><serie>1</serie><nNF>${opts.number ?? 1234}</nNF>
        <dhEmi>2026-10-05T10:30:00-03:00</dhEmi><tpNF>${opts.tpNF ?? 1}</tpNF><finNFe>${opts.finNFe ?? 1}</finNFe>
      </ide>
      <emit><CNPJ>${issuer}</CNPJ><xNome>AUTO PECAS DISTRIBUIDORA LTDA</xNome></emit>
      <dest><CNPJ>${opts.recipient ?? '12ABC34501DE35'}</CNPJ><xNome>OFICINA TESTE LTDA</xNome></dest>
      ${(opts.items ?? [ITEM_BRAKE_PAD, ITEM_NO_GTIN]).join('\n')}
      <total><ICMSTot><vProd>425.80</vProd><vNF>434.85</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe versao="4.00"><infProt><chNFe>${key}</chNFe><cStat>${opts.cStat ?? 100}</cStat></infProt></protNFe>
</nfeProc>`;
  return { xml, key };
}

/** Monta um retDistDFeInt com envelope SOAP, no formato do exemplo da NT 2014.002. */
export function makeDistResponse(opts: {
  cStat: number;
  xMotivo?: string;
  ultNSU?: string;
  maxNSU?: string;
  docs?: { nsu?: string; schema: string; xml: string }[];
}): string {
  const docs = (opts.docs ?? [])
    .map((d) => {
      const nsu = d.nsu ? ` NSU="${d.nsu}"` : '';
      return `<docZip${nsu} schema="${d.schema}">${gzipSync(Buffer.from(d.xml, 'utf8')).toString('base64')}</docZip>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
<nfeDistDFeInteresseResult>
<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
<tpAmb>2</tpAmb><verAplic>1.4.0</verAplic><cStat>${opts.cStat}</cStat><xMotivo>${opts.xMotivo ?? 'x'}</xMotivo>
<dhResp>2026-10-11T11:54:49-03:00</dhResp>
${opts.ultNSU ? `<ultNSU>${opts.ultNSU}</ultNSU>` : ''}${opts.maxNSU ? `<maxNSU>${opts.maxNSU}</maxNSU>` : ''}
${docs ? `<loteDistDFeInt>${docs}</loteDistDFeInt>` : ''}
</retDistDFeInt>
</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`;
}

/** Resumo de NF-e (`resNFe`) no formato do exemplo da NT. `situation`: 1 autorizada, 2 denegada, 3 cancelada. */
export function makeResNfe(key: string, opts: { issuer?: string; situation?: number } = {}): string {
  const issuer = opts.issuer ?? key.slice(6, 20);
  return (
    `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><chNFe>${key}</chNFe><CNPJ>${issuer}</CNPJ>` +
    `<xNome>AUTO PECAS DISTRIBUIDORA LTDA</xNome><IE>0011182040063</IE><dhEmi>2026-10-05T10:30:00-03:00</dhEmi>` +
    `<tpNF>1</tpNF><vNF>434.85</vNF><digVal>abc=</digVal><dhRecbto>2026-10-05T10:31:00-03:00</dhRecbto>` +
    `<nProt>131203850706417</nProt><cSitNFe>${opts.situation ?? 1}</cSitNFe></resNFe>`
  );
}

/** Evento de NF-e: completo (`procEventoNFe`, com o status do `retEvento`) ou resumo (`resEvento`). */
export function makeEvent(key: string, opts: { type?: string; full?: boolean; status?: number } = {}): { schema: string; xml: string } {
  const type = opts.type ?? '110111';
  if (opts.full === false) {
    return {
      schema: 'resEvento_v1.01.xsd',
      xml: `<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${key}</chNFe><tpEvento>${type}</tpEvento><nSeqEvento>1</nSeqEvento></resEvento>`,
    };
  }
  return {
    schema: 'procEventoNFe_v1.00.xsd',
    xml:
      `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00"><infEvento Id="ID${type}${key}01">` +
      `<chNFe>${key}</chNFe><tpEvento>${type}</tpEvento></infEvento></evento>` +
      `<retEvento versao="1.00"><infEvento><cStat>${opts.status ?? 135}</cStat><chNFe>${key}</chNFe></infEvento></retEvento></procEventoNFe>`,
  };
}
