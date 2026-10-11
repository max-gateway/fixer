import forge from 'node-forge';
import { isValidCnpj, normalizeCnpj } from '../cnpj.js';

/** OID da extensão ICP-Brasil que carrega o CNPJ do titular (otherName em subjectAltName). */
const OID_CNPJ = '2.16.76.1.3.3';

export type PfxErrorCode = 'INVALID_FILE' | 'WRONG_PASSWORD' | 'NO_PRIVATE_KEY' | 'NO_CERTIFICATE' | 'NO_CNPJ';

/** Erro de validação do .pfx; a mensagem é segura para devolver ao usuário (nunca contém segredo). */
export class PfxError extends Error {
  constructor(
    readonly code: PfxErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ParsedPfx {
  /** Chave privada e cadeia em PEM, só para uso em memória (https.Agent / assinatura). Nunca persistir. */
  keyPem: string;
  certPem: string;
  chainPem: string[];
  subject: string;
  certCnpj: string;
  notBefore: Date;
  notAfter: Date;
}

/**
 * Abre o PKCS#12 em JS puro (node-forge). O OpenSSL 3 do runtime recusa .pfx legado (RC2/3DES) sem
 * o legacy provider; certificados A1 antigos ainda circulam, então não dependemos dele.
 */
export function parsePfx(pfx: Buffer, password: string): ParsedPfx {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/password|MAC/i.test(msg)) throw new PfxError('WRONG_PASSWORD', 'Senha do certificado incorreta');
    throw new PfxError('INVALID_FILE', 'Arquivo não é um certificado .pfx/.p12 válido');
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const key = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new PfxError('NO_PRIVATE_KEY', 'O arquivo não contém chave privada');

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  if (certs.length === 0) throw new PfxError('NO_CERTIFICATE', 'O arquivo não contém certificado');

  // O certificado do titular é o que casa com a chave privada; os demais são a cadeia.
  const leaf = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.compareTo(key.n) === 0) ?? certs[0]!;
  const chain = certs.filter((c) => c !== leaf);

  const rawCnpj = extractCnpj(leaf);
  const certCnpj = rawCnpj ? normalizeCnpj(rawCnpj) : '';
  if (!isValidCnpj(certCnpj)) {
    throw new PfxError('NO_CNPJ', 'O certificado não é e-CNPJ (sem a extensão de CNPJ da ICP-Brasil)');
  }

  return {
    keyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(leaf),
    chainPem: chain.map((c) => forge.pki.certificateToPem(c)),
    subject: (leaf.subject.getField('CN')?.value as string | undefined) ?? leaf.subject.attributes.map((a) => a.value).join(', '),
    certCnpj,
    notBefore: leaf.validity.notBefore,
    notAfter: leaf.validity.notAfter,
  };
}

function extractCnpj(cert: forge.pki.Certificate): string | null {
  const san = cert.getExtension('subjectAltName') as { value?: string } | null;
  if (!san?.value) return null;
  try {
    return findOtherName(forge.asn1.fromDer(forge.util.createBuffer(san.value)), OID_CNPJ);
  } catch {
    return null;
  }
}

/** Procura `otherName { OID, [0] EXPLICIT valor }` e devolve o valor como string. */
function findOtherName(node: forge.asn1.Asn1, oid: string): string | null {
  if (!Array.isArray(node.value)) return null;
  const children = node.value as forge.asn1.Asn1[];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.type === forge.asn1.Type.OID && typeof child.value === 'string' && forge.asn1.derToOid(child.value) === oid) {
      const holder = children[i + 1];
      if (holder) return asString(holder);
    }
    const nested = findOtherName(child, oid);
    if (nested) return nested;
  }
  return null;
}

function asString(node: forge.asn1.Asn1): string | null {
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.value) && node.value.length > 0) return asString(node.value[0] as forge.asn1.Asn1);
  return null;
}
