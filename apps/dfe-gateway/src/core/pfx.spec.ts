import { describe, expect, it } from 'vitest';
import { makePfx } from '../../test/make-pfx.js';
import { parsePfx, PfxError } from './pfx.js';

describe('parsePfx', () => {
  it('lê CNPJ (otherName 2.16.76.1.3.3), validade, titular e PEMs', () => {
    const { pfx, password } = makePfx({ cnpj: '12ABC34501DE35' });
    const parsed = parsePfx(pfx, password);
    expect(parsed.certCnpj).toBe('12ABC34501DE35');
    expect(parsed.subject).toBe('OFICINA TESTE LTDA:12ABC34501DE35');
    expect(parsed.notAfter.getTime()).toBeGreaterThan(Date.now());
    expect(parsed.keyPem).toContain('PRIVATE KEY');
    expect(parsed.certPem).toContain('BEGIN CERTIFICATE');
  });

  it('lê CNPJ numérico e normaliza máscara', () => {
    const { pfx, password } = makePfx({ cnpj: '11.222.333/0001-81' });
    expect(parsePfx(pfx, password).certCnpj).toBe('11222333000181');
  });

  it('abre .pfx com PBES2/AES (gerado por OpenSSL 3 recente)', () => {
    const { pfx, password } = makePfx({ cnpj: '11222333000181', algorithm: 'aes256' });
    expect(parsePfx(pfx, password).certCnpj).toBe('11222333000181');
  });

  it('senha errada', () => {
    const { pfx } = makePfx({ cnpj: '11222333000181' });
    expect(() => parsePfx(pfx, 'errada')).toThrowError(expect.objectContaining({ code: 'WRONG_PASSWORD' }));
  });

  it('arquivo que não é PKCS#12', () => {
    expect(() => parsePfx(Buffer.from('isso não é um certificado'), 'x')).toThrowError(
      expect.objectContaining({ code: 'INVALID_FILE' }),
    );
  });

  it('certificado sem a extensão de CNPJ (não é e-CNPJ)', () => {
    const { pfx, password } = makePfx();
    expect(() => parsePfx(pfx, password)).toThrow(PfxError);
    expect(() => parsePfx(pfx, password)).toThrowError(expect.objectContaining({ code: 'NO_CNPJ' }));
  });

  it('CNPJ com dígito verificador inválido na extensão é tratado como ausente', () => {
    const { pfx, password } = makePfx({ cnpj: '11222333000199' });
    expect(() => parsePfx(pfx, password)).toThrowError(expect.objectContaining({ code: 'NO_CNPJ' }));
  });

  it('a mensagem de erro nunca contém a senha', () => {
    const { pfx } = makePfx({ cnpj: '11222333000181' });
    try {
      parsePfx(pfx, 'senha-secreta-123');
    } catch (err) {
      expect(String(err)).not.toContain('senha-secreta-123');
    }
  });
});
