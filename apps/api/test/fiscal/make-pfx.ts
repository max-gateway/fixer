import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

export interface MakePfxOptions {
  /** CNPJ gravado no otherName 2.16.76.1.3.3 (omitir = certificado sem a extensão). */
  cnpj?: string;
  password?: string;
  notBefore?: Date;
  notAfter?: Date;
  commonName?: string;
  algorithm?: '3des' | 'aes256';
}

/** 2048 bits: o OpenSSL 3 do Node recusa menos que isso em TLS (security level 2). Node gera rápido; o forge só lê o PEM. */
export function newRsaKeys(): { privateKey: forge.pki.rsa.PrivateKey; publicKey: forge.pki.rsa.PublicKey } {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const key = forge.pki.privateKeyFromPem(privateKey);
  return { privateKey: key, publicKey: forge.pki.setRsaPublicKey(key.n, key.e) };
}

const keys = newRsaKeys();

/** Gera um .pfx de teste (autoassinado, 2048 bits) com a extensão de CNPJ da ICP-Brasil. Só para testes. */
export function makePfx(opts: MakePfxOptions = {}): { pfx: Buffer; password: string } {
  const password = opts.password ?? 'senha-de-teste';
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  const now = Date.now();
  cert.validity.notBefore = opts.notBefore ?? new Date(now - 86_400_000);
  cert.validity.notAfter = opts.notAfter ?? new Date(now + 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: opts.commonName ?? 'OFICINA TESTE LTDA:12ABC34501DE35' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  const extensions: object[] = [];
  if (opts.cnpj) {
    const { asn1 } = forge;
    // subjectAltName ::= SEQUENCE { [0] otherName { OID 2.16.76.1.3.3, [0] EXPLICIT UTF8String cnpj } }
    const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.76.1.3.3').getBytes()),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTF8, false, forge.util.encodeUtf8(opts.cnpj)),
      ]),
    ]);
    const san = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [otherName]);
    extensions.push({ id: '2.5.29.17', critical: false, value: asn1.toDer(san).getBytes() });
  }
  cert.setExtensions(extensions);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: opts.algorithm ?? '3des' });
  return { pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), password };
}
