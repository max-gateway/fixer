import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Guarda da chave mestra (KEK) que embrulha as chaves de dados (DEK) do certificado fiscal.
 * A v1 lê a KEK de um Secret do Kubernetes (`EnvKeyProvider`); trocar por KMS é implementar esta
 * interface (nenhum dado migra: só se re-embrulha a DEK). Ver docs/specs/nfe-import.md §7.2–7.3.
 */
export interface KeyProvider {
  /** Falso quando a configuração de chave está ausente: a funcionalidade fiscal fica indisponível. */
  readonly available: boolean;
  readonly activeKeyId: string;
  wrap(dek: Buffer): Promise<{ keyId: string; wrapped: Buffer }>;
  unwrap(keyId: string, wrapped: Buffer): Promise<Buffer>;
}

const KEK_AAD = Buffer.from('fixer-fiscal-dek-v1');
const IV_LEN = 12;
const TAG_LEN = 16;
/** DEK de 32 B embrulhada: iv(12) + tag(16) + ciphertext(32). */
export const WRAPPED_DEK_LEN = IV_LEN + TAG_LEN + 32;

export class EnvKeyProvider implements KeyProvider {
  readonly available = true;

  private constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    readonly activeKeyId: string,
  ) {}

  /** `FISCAL_ENC_KEYS` = JSON `{ "k1": "<base64 de 32 bytes>" }`; `FISCAL_ACTIVE_KEY_ID` = id da chave de escrita. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): KeyProvider {
    const raw = env.FISCAL_ENC_KEYS;
    const active = env.FISCAL_ACTIVE_KEY_ID;
    if (!raw || !active) return new UnavailableKeyProvider();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('FISCAL_ENC_KEYS não é um JSON válido');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('FISCAL_ENC_KEYS deve ser um objeto { id: base64 }');
    }
    const keys = new Map<string, Buffer>();
    for (const [id, b64] of Object.entries(parsed)) {
      const key = typeof b64 === 'string' ? Buffer.from(b64, 'base64') : Buffer.alloc(0);
      if (key.length !== 32) throw new Error(`FISCAL_ENC_KEYS["${id}"] deve ter 32 bytes em base64`);
      keys.set(id, key);
    }
    if (!keys.has(active)) throw new Error(`FISCAL_ACTIVE_KEY_ID "${active}" não existe em FISCAL_ENC_KEYS`);
    return new EnvKeyProvider(keys, active);
  }

  async wrap(dek: Buffer): Promise<{ keyId: string; wrapped: Buffer }> {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key(this.activeKeyId), iv);
    cipher.setAAD(KEK_AAD);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    return { keyId: this.activeKeyId, wrapped: Buffer.concat([iv, cipher.getAuthTag(), ct]) };
  }

  async unwrap(keyId: string, wrapped: Buffer): Promise<Buffer> {
    if (wrapped.length !== WRAPPED_DEK_LEN) throw new Error('DEK embrulhada com tamanho inválido');
    const iv = wrapped.subarray(0, IV_LEN);
    const tag = wrapped.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = wrapped.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', this.key(keyId), iv);
    decipher.setAAD(KEK_AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  private key(id: string): Buffer {
    const key = this.keys.get(id);
    if (!key) throw new Error(`Chave mestra "${id}" não está disponível (FISCAL_ENC_KEYS)`);
    return key;
  }
}

class UnavailableKeyProvider implements KeyProvider {
  readonly available = false;
  readonly activeKeyId = '';
  wrap(): Promise<never> {
    return Promise.reject(new Error('Chave mestra fiscal não configurada (FISCAL_ENC_KEYS)'));
  }
  unwrap(): Promise<never> {
    return Promise.reject(new Error('Chave mestra fiscal não configurada (FISCAL_ENC_KEYS)'));
  }
}
