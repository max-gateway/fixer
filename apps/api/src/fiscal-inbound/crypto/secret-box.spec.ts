import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvKeyProvider } from './key-provider.js';
import { open, rewrap, seal } from './secret-box.js';

const key = () => randomBytes(32).toString('base64');
const providerWith = (keys: Record<string, string>, active: string) =>
  EnvKeyProvider.fromEnv({ FISCAL_ENC_KEYS: JSON.stringify(keys), FISCAL_ACTIVE_KEY_ID: active });

describe('EnvKeyProvider', () => {
  it('sem configuração fica indisponível em vez de quebrar a API', async () => {
    const p = EnvKeyProvider.fromEnv({});
    expect(p.available).toBe(false);
    await expect(p.wrap(randomBytes(32))).rejects.toThrow(/não configurada/);
  });

  it('recusa configuração malformada (fail fast)', () => {
    expect(() => EnvKeyProvider.fromEnv({ FISCAL_ENC_KEYS: '{', FISCAL_ACTIVE_KEY_ID: 'k1' })).toThrow(/JSON/);
    expect(() => providerWith({ k1: Buffer.alloc(16).toString('base64') }, 'k1')).toThrow(/32 bytes/);
    expect(() => providerWith({ k1: key() }, 'k2')).toThrow(/k2/);
  });
});

describe('secret-box (envelope AES-256-GCM)', () => {
  const k1 = key();
  const p = providerWith({ k1 }, 'k1');
  const secret = Buffer.from('conteúdo-do-pfx\u0000ÿ');

  it('ida e volta', async () => {
    const { keyId, blob } = await seal(p, secret, 'ctx');
    expect(keyId).toBe('k1');
    expect(blob.includes(secret)).toBe(false);
    expect((await open(p, keyId, blob, 'ctx')).equals(secret)).toBe(true);
  });

  it('cada selagem usa IV e DEK novos', async () => {
    const a = await seal(p, secret, 'ctx');
    const b = await seal(p, secret, 'ctx');
    expect(a.blob.equals(b.blob)).toBe(false);
  });

  it('o contexto é autenticado: blob de um campo não abre em outro', async () => {
    const { keyId, blob } = await seal(p, secret, 'fiscal-credential:pfx');
    await expect(open(p, keyId, blob, 'fiscal-credential:pfx-pass')).rejects.toThrow();
  });

  it('detecta adulteração do ciphertext e da DEK embrulhada', async () => {
    const { keyId, blob } = await seal(p, secret, 'ctx');
    const tamperedData = Buffer.from(blob);
    tamperedData[tamperedData.length - 1]! ^= 1;
    await expect(open(p, keyId, tamperedData, 'ctx')).rejects.toThrow();
    const tamperedDek = Buffer.from(blob);
    tamperedDek[5]! ^= 1;
    await expect(open(p, keyId, tamperedDek, 'ctx')).rejects.toThrow();
  });

  it('chave mestra errada não decifra', async () => {
    const { keyId, blob } = await seal(p, secret, 'ctx');
    const other = providerWith({ [keyId]: key() }, keyId);
    await expect(open(other, keyId, blob, 'ctx')).rejects.toThrow();
  });

  it('rejeita blob truncado ou de versão desconhecida', async () => {
    await expect(open(p, 'k1', Buffer.alloc(10), 'ctx')).rejects.toThrow(/inválido/);
    const { blob } = await seal(p, secret, 'ctx');
    const v2 = Buffer.from(blob);
    v2[0] = 2;
    await expect(open(p, 'k1', v2, 'ctx')).rejects.toThrow(/inválido/);
  });

  it('rotação: rewrap troca a chave mestra sem tocar nos dados e continua decifrando', async () => {
    const k2 = key();
    const before = await seal(p, secret, 'ctx');
    const rotated = providerWith({ k1, k2 }, 'k2');
    const after = await rewrap(rotated, before.keyId, before.blob);
    expect(after.keyId).toBe('k2');
    // O trecho dos dados (depois do header) é idêntico: só a DEK foi re-embrulhada.
    expect(after.blob.subarray(61).equals(before.blob.subarray(61))).toBe(true);
    expect((await open(rotated, 'k2', after.blob, 'ctx')).equals(secret)).toBe(true);
    // Sem a k1 na configuração, o blob antigo já não abre, o novo sim.
    const onlyK2 = providerWith({ k2 }, 'k2');
    await expect(open(onlyK2, 'k1', before.blob, 'ctx')).rejects.toThrow();
    expect((await open(onlyK2, 'k2', after.blob, 'ctx')).equals(secret)).toBe(true);
  });
});
