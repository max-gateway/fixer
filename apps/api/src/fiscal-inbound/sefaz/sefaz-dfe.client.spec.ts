import { SignedXml } from 'xml-crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeAccessKey, makeDistResponse, makeProcNfe } from '../../../test/fiscal/nfe-xml.js';
import { makePfx } from '../../../test/fiscal/make-pfx.js';
import { makeServerCert, startFakeSefaz } from '../../../test/fiscal/tls.js';
import { parsePfx } from '../credentials/pfx.js';
import type { CredentialMaterial } from '../credentials/credential.service.js';
import { testConfig } from '../../../test/fiscal/config.js';
import type { FiscalConfig } from '../fiscal.config.js';
import { SefazNotConfiguredError, SefazTransportError } from './dfe-source.js';
import { eventId } from './event-xml.js';
import { buildDistNsuEnvelope, buildEventSoap, SefazDfeClient } from './sefaz-dfe.client.js';

const CNPJ = '12ABC34501DE35';
const server = makeServerCert();
let material: CredentialMaterial;

beforeAll(() => {
  const { pfx, password } = makePfx({ cnpj: CNPJ, commonName: 'OFICINA TESTE LTDA:12ABC34501DE35' });
  material = { ...parsePfx(pfx, password), environment: 'HOMOLOGATION' };
});

const config = (url: string | undefined, over: Partial<FiscalConfig> = {}): FiscalConfig =>
  testConfig({ distUrl: { HOMOLOGATION: url }, caPem: server.certPem, ...over });

describe('buildDistNsuEnvelope', () => {
  it('segue o exemplo 1 da NT 2014.002: tpAmb, cUFAutor, CNPJ e ultNSU com 15 dígitos', () => {
    const xml = buildDistNsuEnvelope({ tpAmb: 2, cnpj: CNPJ, ufCode: 35, ultNsu: 1n });
    expect(xml).toContain('<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">');
    expect(xml).toContain('<tpAmb>2</tpAmb><cUFAutor>35</cUFAutor><CNPJ>12ABC34501DE35</CNPJ>');
    expect(xml).toContain('<distNSU><ultNSU>000000000000001</ultNSU></distNSU>');
    expect(xml).toContain('<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">');
  });

  it('cUFAutor é opcional (0-1 no leiaute) e o NSU grande não perde dígitos', () => {
    const xml = buildDistNsuEnvelope({ tpAmb: 1, cnpj: CNPJ, ufCode: null, ultNsu: 123456789012345n });
    expect(xml).not.toContain('cUFAutor');
    expect(xml).toContain('<ultNSU>123456789012345</ultNSU>');
    expect(xml).toContain('<tpAmb>1</tpAmb>');
  });
});

describe('SefazDfeClient (TLS mútuo contra um servidor local)', () => {
  const nfe = makeProcNfe();
  let sefaz: Awaited<ReturnType<typeof startFakeSefaz>>;
  let reply: () => { status: number; body: string };

  beforeAll(async () => {
    sefaz = await startFakeSefaz(server, () => reply());
  });
  afterAll(() => sefaz.close());

  it('apresenta o certificado A1 do tenant, envia o SOAP e devolve o lote já interpretado', async () => {
    reply = () => ({
      status: 200,
      body: makeDistResponse({ cStat: 138, ultNSU: '7', maxNSU: '7', docs: [{ nsu: '7', schema: 'procNFe_v4.00.xsd', xml: nfe.xml }] }),
    });
    const client = new SefazDfeClient(config(sefaz.url));
    const res = await client.distribute(material, { cnpj: CNPJ, ufCode: 35, ultNsu: 6n });

    expect(res).toMatchObject({ cStat: 138, ultNsu: 7n, maxNsu: 7n });
    expect(res.documents[0]).toMatchObject({ nsu: 7n, schema: 'procNFe_v4.00.xsd', xml: nfe.xml });

    const req = sefaz.seen.at(-1)!;
    expect(req.clientCn).toBe('OFICINA TESTE LTDA:12ABC34501DE35'); // o handshake mTLS trouxe o certificado
    expect(req.method).toBe('POST');
    expect(req.headers['content-type']).toBe('text/xml; charset=utf-8');
    expect(req.headers.soapaction).toBe('"http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"');
    expect(req.body).toContain('<ultNSU>000000000000006</ultNSU>');
    expect(req.body).toContain('<tpAmb>2</tpAmb>'); // ambiente do certificado, não do código
  });

  it('o corpo enviado nunca contém material do certificado', async () => {
    reply = () => ({ status: 200, body: makeDistResponse({ cStat: 137, ultNSU: '0', maxNSU: '0' }) });
    await new SefazDfeClient(config(sefaz.url)).distribute(material, { cnpj: CNPJ, ultNsu: 0n });
    const body = sefaz.seen.at(-1)!.body;
    expect(body).not.toContain('PRIVATE KEY');
    expect(body).not.toContain('BEGIN CERTIFICATE');
  });

  it('HTTP diferente de 200 vira falha de transporte com o status', async () => {
    reply = () => ({ status: 503, body: 'indisponível' });
    const err = await new SefazDfeClient(config(sefaz.url)).distribute(material, { cnpj: CNPJ, ultNsu: 0n }).catch((e) => e);
    expect(err).toBeInstanceOf(SefazTransportError);
    expect(err.httpStatus).toBe(503);
  });

  it('resposta que não é o retDistDFeInt vira falha de transporte, não exceção solta', async () => {
    reply = () => ({ status: 200, body: '<html>proxy error</html>' });
    await expect(new SefazDfeClient(config(sefaz.url)).distribute(material, { cnpj: CNPJ, ultNsu: 0n })).rejects.toBeInstanceOf(
      SefazTransportError,
    );
  });

  it('não desliga a verificação do servidor: cadeia desconhecida é recusada', async () => {
    reply = () => ({ status: 200, body: makeDistResponse({ cStat: 137, ultNSU: '0', maxNSU: '0' }) });
    const before = sefaz.seen.length;
    const err = await new SefazDfeClient(config(sefaz.url, { caPem: undefined })).distribute(material, { cnpj: CNPJ, ultNsu: 0n }).catch((e) => e);
    expect(err).toBeInstanceOf(SefazTransportError);
    expect(err.message).toMatch(/rede\/TLS/);
    expect(sefaz.seen.length).toBe(before); // nada chegou a ser enviado
  });

  it('timeout vira falha de transporte', async () => {
    reply = () => ({ status: 200, body: '' });
    const slow = await startFakeSefaz(server, () => new Promise(() => undefined) as never);
    const client = new SefazDfeClient(config(slow.url, { requestTimeoutMs: 150 }));
    await expect(client.distribute(material, { cnpj: CNPJ, ultNsu: 0n })).rejects.toThrow(/timeout/);
    await slow.close();
  });
});

describe('SefazDfeClient: configuração', () => {
  it('sem URL para o ambiente do certificado: erro de configuração, sem rede', async () => {
    await expect(new SefazDfeClient(config(undefined)).distribute(material, { cnpj: CNPJ, ultNsu: 0n })).rejects.toBeInstanceOf(
      SefazNotConfiguredError,
    );
  });

  it('recusa URL http (a SEFAZ exige TLS)', async () => {
    const client = new SefazDfeClient(config('http://127.0.0.1:1/x'));
    await expect(client.distribute(material, { cnpj: CNPJ, ultNsu: 0n })).rejects.toBeInstanceOf(SefazNotConfiguredError);
  });
});

describe('SefazDfeClient.manifest (Ciência da Operação, TLS mútuo)', () => {
  const NOW = new Date('2026-10-11T15:00:00Z');
  const keys = [makeAccessKey('11222333000181', 1), makeAccessKey('11222333000181', 2)];
  const reply = (cStat = 135) =>
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>` +
    keys.map((k) => `<retEvento versao="1.00"><infEvento><cStat>${cStat}</cStat><xMotivo>ok</xMotivo><chNFe>${k}</chNFe><nProt>891260000000001</nProt></infEvento></retEvento>`).join('') +
    `</retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`;

  let sefaz: Awaited<ReturnType<typeof startFakeSefaz>>;
  beforeAll(async () => {
    sefaz = await startFakeSefaz(server, () => ({ status: 200, body: reply() }));
  });
  afterAll(() => sefaz.close());

  const cfg = (over: Partial<FiscalConfig> = {}) => config(undefined, { eventUrl: { HOMOLOGATION: sefaz.url }, ...over });

  it('envia o lote assinado com o certificado do tenant e devolve o resultado de cada evento', async () => {
    const res = await new SefazDfeClient(cfg()).manifest(material, { cnpj: CNPJ, accessKeys: keys, now: NOW });
    expect(res.batchStatus).toBe(128);
    expect(res.events).toEqual(keys.map((k) => ({ accessKey: k, cStat: 135, xMotivo: 'ok', protocol: '891260000000001' })));

    const req = sefaz.seen.at(-1)!;
    expect(req.clientCn).toBe('OFICINA TESTE LTDA:12ABC34501DE35'); // mTLS com o A1
    expect(req.headers['content-type']).toBe(
      'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
    );
    expect(req.body).toContain('<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">');
    expect(req.body).toContain('<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><envEvento ');
  });

  it('cada evento do corpo tem Id correto, ambiente do certificado e assinatura válida', async () => {
    await new SefazDfeClient(cfg()).manifest(material, { cnpj: CNPJ, accessKeys: keys, now: NOW });
    const body = sefaz.seen.at(-1)!.body;
    const envEvento = body.match(/<envEvento[\s\S]*<\/envEvento>/)![0];

    for (const k of keys) expect(envEvento).toContain(`<infEvento Id="${eventId('210210', k)}">`);
    expect(envEvento).toContain('<tpAmb>2</tpAmb>'); // homologação
    expect(envEvento).toContain(`<CNPJ>${CNPJ}</CNPJ>`);
    expect(envEvento.match(/<evento /g)).toHaveLength(2);

    // Verifica de fato cada assinatura, no envelope exatamente como a SEFAZ o recebeu.
    const signatures = envEvento.match(/<Signature[\s\S]*?<\/Signature>/g)!;
    expect(signatures).toHaveLength(2);
    for (const sig of signatures) {
      const doc = new SignedXml({ publicCert: material.certPem });
      doc.loadSignature(sig);
      expect(doc.checkSignature(envEvento)).toBe(true);
    }
    expect(body).not.toContain('PRIVATE KEY');
    expect(envEvento).not.toMatch(/>\s+</);
  });

  it('FISCAL_EVENT_SOAP=1.1 troca o envelope e usa SOAPAction', async () => {
    await new SefazDfeClient(cfg({ eventSoap: '1.1' })).manifest(material, { cnpj: CNPJ, accessKeys: [keys[0]!], now: NOW });
    const req = sefaz.seen.at(-1)!;
    expect(req.headers['content-type']).toBe('text/xml; charset=utf-8');
    expect(req.headers.soapaction).toBe('"http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"');
    expect(req.body).toContain('<nfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">');
  });

  it('o ambiente do certificado decide o tpAmb e a URL', async () => {
    const prod = { ...material, environment: 'PRODUCTION' as const };
    await new SefazDfeClient(cfg({ eventUrl: { PRODUCTION: sefaz.url } })).manifest(prod, { cnpj: CNPJ, accessKeys: [keys[0]!], now: NOW });
    expect(sefaz.seen.at(-1)!.body).toContain('<tpAmb>1</tpAmb>');
  });

  it('sem URL do serviço de eventos: erro de configuração, nada é enviado', async () => {
    const before = sefaz.seen.length;
    await expect(new SefazDfeClient(cfg({ eventUrl: {} })).manifest(material, { cnpj: CNPJ, accessKeys: keys, now: NOW })).rejects.toBeInstanceOf(
      SefazNotConfiguredError,
    );
    expect(sefaz.seen.length).toBe(before);
  });

  it('HTTP 500 e corpo ilegível viram falha de transporte', async () => {
    const bad = await startFakeSefaz(server, () => ({ status: 500, body: 'x' }));
    await expect(new SefazDfeClient(cfg({ eventUrl: { HOMOLOGATION: bad.url } })).manifest(material, { cnpj: CNPJ, accessKeys: keys, now: NOW })).rejects.toBeInstanceOf(
      SefazTransportError,
    );
    await bad.close();
    const junk = await startFakeSefaz(server, () => ({ status: 200, body: '<html/>' }));
    await expect(new SefazDfeClient(cfg({ eventUrl: { HOMOLOGATION: junk.url } })).manifest(material, { cnpj: CNPJ, accessKeys: keys, now: NOW })).rejects.toBeInstanceOf(
      SefazTransportError,
    );
    await junk.close();
  });
});

describe('buildEventSoap', () => {
  it('1.2 não usa SOAPAction (vai no Content-Type); 1.1 usa', () => {
    expect(buildEventSoap('<envEvento/>', '1.2').soapAction).toBeUndefined();
    expect(buildEventSoap('<envEvento/>', '1.1').soapAction).toContain('nfeRecepcaoEvento');
  });
});
