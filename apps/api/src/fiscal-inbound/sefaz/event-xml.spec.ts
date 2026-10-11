import { X509Certificate } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { describe, expect, it } from 'vitest';
import { makeAccessKey } from '../../../test/fiscal/nfe-xml.js';
import { makePfx } from '../../../test/fiscal/make-pfx.js';
import { parsePfx } from '../credentials/pfx.js';
import { brtTimestamp, buildCienciaEvent, buildEnvEvento, eventId, signEnvEvento } from './event-xml.js';

const CNPJ = '12ABC34501DE35';
const KEY = makeAccessKey('11222333000181');
const NOW = new Date('2026-10-11T15:00:00Z'); // 12:00 em Brasília
const { pfx, password } = makePfx({ cnpj: CNPJ });
const cert = parsePfx(pfx, password);

describe('evento de Ciência da Operação (NT 2020.001)', () => {
  it('Id = "ID" + tpEvento + chave + nSeqEvento de 2 dígitos (54 posições)', () => {
    const id = eventId('210210', KEY);
    expect(id).toBe(`ID210210${KEY}01`);
    expect(id).toHaveLength(54);
  });

  it('data no formato da NT, em Brasília, um pouco no passado (SEFAZ rejeita data futura: 578)', () => {
    expect(brtTimestamp(NOW, 0)).toBe('2026-10-11T12:00:00-03:00');
    expect(brtTimestamp(NOW)).toBe('2026-10-11T11:59:30-03:00');
  });

  it('monta os campos P08–P19 na ordem do leiaute, com cOrgao 91 (Ambiente Nacional) e nSeqEvento 1', () => {
    const xml = buildCienciaEvent({ tpAmb: 2, cnpj: CNPJ, accessKey: KEY, now: NOW });
    expect(xml).toBe(
      `<evento versao="1.00"><infEvento Id="ID210210${KEY}01"><cOrgao>91</cOrgao><tpAmb>2</tpAmb><CNPJ>${CNPJ}</CNPJ>` +
        `<chNFe>${KEY}</chNFe><dhEvento>2026-10-11T11:59:30-03:00</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento>` +
        '<verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento></evento>',
    );
  });

  it('sem espaços ou quebras entre as tags (a SEFAZ rejeita: 588)', () => {
    const env = buildEnvEvento('1', [buildCienciaEvent({ tpAmb: 1, cnpj: CNPJ, accessKey: KEY, now: NOW })]);
    expect(env).not.toMatch(/>\s+</);
    expect(env).not.toMatch(/[\r\n\t]/);
    expect(env.startsWith('<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><evento')).toBe(true);
  });

  it('lote de 1 a 20 eventos', () => {
    const ev = buildCienciaEvent({ tpAmb: 1, cnpj: CNPJ, accessKey: KEY, now: NOW });
    expect(() => buildEnvEvento('1', [])).toThrow(/1 a 20/);
    expect(() => buildEnvEvento('1', Array(21).fill(ev))).toThrow(/1 a 20/);
    expect(() => buildEnvEvento('1', Array(20).fill(ev))).not.toThrow();
  });
});

describe('assinatura XMLDSig (padrão NF-e)', () => {
  const unsigned = buildEnvEvento('7', [buildCienciaEvent({ tpAmb: 2, cnpj: CNPJ, accessKey: KEY, now: NOW })]);
  const id = eventId('210210', KEY);
  const signed = signEnvEvento(unsigned, cert.keyPem, cert.certPem, [id]);

  const verify = (xml: string) => {
    const doc = new SignedXml({ publicCert: cert.certPem });
    const sigNode = xml.match(/<Signature[\s\S]*?<\/Signature>/)![0];
    doc.loadSignature(sigNode);
    return { ok: doc.checkSignature(xml) };
  };

  it('a assinatura valida contra o certificado do titular', () => {
    expect(verify(signed).ok).toBe(true);
  });

  it('usa exatamente os algoritmos do "padrão do Projeto" (rejeição 298 se divergir)', () => {
    expect(signed).toContain('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>');
    expect(signed).toContain('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>');
    expect(signed).toContain('<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>');
    expect(signed).toContain('<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>');
    expect(signed).toContain(`<Reference URI="#${id}">`);
  });

  it('a Signature fica dentro de <evento>, logo depois do <infEvento> (P91 da NT)', () => {
    expect(signed).toMatch(/<\/infEvento><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
    expect(signed).toMatch(/<\/Signature><\/evento><\/envEvento>$/);
  });

  it('KeyInfo só com o certificado do titular em base64 DER, sem chave privada nem quebras', () => {
    const x509 = signed.match(/<X509Certificate>([^<]+)<\/X509Certificate>/)![1]!;
    expect(x509).not.toMatch(/\s/);
    expect(Buffer.from(x509, 'base64').equals(new X509Certificate(cert.certPem).raw)).toBe(true);
    expect(signed).not.toContain('PRIVATE KEY');
    expect(signed).not.toMatch(/>\s+</);
  });

  it('adulterar o conteúdo assinado invalida a assinatura', () => {
    const tampered = signed.replace(`<chNFe>${KEY}</chNFe>`, `<chNFe>${makeAccessKey('11222333000181', 9)}</chNFe>`);
    expect(verify(tampered).ok).toBe(false);
  });

  it('lote com vários eventos: cada infEvento recebe a sua assinatura', () => {
    const keys = [makeAccessKey('11222333000181', 1), makeAccessKey('11222333000181', 2), makeAccessKey('11222333000181', 3)];
    const env = buildEnvEvento('9', keys.map((k) => buildCienciaEvent({ tpAmb: 2, cnpj: CNPJ, accessKey: k, now: NOW })));
    const out = signEnvEvento(env, cert.keyPem, cert.certPem, keys.map((k) => eventId('210210', k)));
    expect(out.match(/<Signature /g)).toHaveLength(3);
    for (const [i, k] of keys.entries()) {
      const evento = out.split('<evento ')[i + 1]!;
      expect(evento).toContain(`Id="${eventId('210210', k)}"`);
      expect(evento).toContain(`<Reference URI="#${eventId('210210', k)}">`);
    }
  });

  it('assinar duas vezes o mesmo envelope dá o mesmo resultado verificável (determinístico no conteúdo)', () => {
    const again = signEnvEvento(unsigned, cert.keyPem, cert.certPem, [id]);
    expect(verify(again).ok).toBe(true);
    expect(again).toBe(signed); // RSA PKCS#1 v1.5 é determinístico
  });
});
