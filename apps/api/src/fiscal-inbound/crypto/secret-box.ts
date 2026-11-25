import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { WRAPPED_DEK_LEN, type KeyProvider } from './key-provider.js';

/**
 * Criptografia em envelope: cada segredo ganha uma DEK própria (AES-256-GCM) e a DEK vai embrulhada
 * pela chave mestra dentro do próprio blob. Layout:
 *   v(1) | dekEmbrulhada(60) | iv(12) | tag(16) | ciphertext
 * `context` entra como AAD: um blob de um campo não decifra em outro (ex.: pfx ↔ senha).
 */
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER = 1 + WRAPPED_DEK_LEN;

export async function seal(
  provider: KeyProvider,
  plaintext: Buffer,
  context: string,
): Promise<{ keyId: string; blob: Buffer }> {
  const dek = randomBytes(32);
  try {
    const { keyId, wrapped } = await provider.wrap(dek);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(Buffer.from(context));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const blob = Buffer.concat([Buffer.from([VERSION]), wrapped, iv, cipher.getAuthTag(), ct]);
    return { keyId, blob };
  } finally {
    dek.fill(0);
  }
}

export async function open(provider: KeyProvider, keyId: string, blob: Buffer, context: string): Promise<Buffer> {
  if (blob.length < HEADER + IV_LEN + TAG_LEN || blob[0] !== VERSION) throw new Error('Blob cifrado inválido');
  const wrapped = blob.subarray(1, HEADER);
  const iv = blob.subarray(HEADER, HEADER + IV_LEN);
  const tag = blob.subarray(HEADER + IV_LEN, HEADER + IV_LEN + TAG_LEN);
  const ct = blob.subarray(HEADER + IV_LEN + TAG_LEN);
  const dek = await provider.unwrap(keyId, wrapped);
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } finally {
    dek.fill(0);
  }
}

/** Re-embrulha só a DEK com a chave ativa; o ciphertext dos dados não é tocado (rotação, `fiscal:rewrap`). */
export async function rewrap(provider: KeyProvider, fromKeyId: string, blob: Buffer): Promise<{ keyId: string; blob: Buffer }> {
  if (blob.length < HEADER || blob[0] !== VERSION) throw new Error('Blob cifrado inválido');
  const dek = await provider.unwrap(fromKeyId, blob.subarray(1, HEADER));
  try {
    const { keyId, wrapped } = await provider.wrap(dek);
    return { keyId, blob: Buffer.concat([Buffer.from([VERSION]), wrapped, blob.subarray(HEADER)]) };
  } finally {
    dek.fill(0);
  }
}
