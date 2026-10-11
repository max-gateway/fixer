import { describe, expect, it } from 'vitest';
import { NT_SAMPLE_ACCESS_KEY } from '../../test/fiscal/nt-sample.js';
import { accessKeyCheckDigit, cnpjBase, isValidAccessKey, isValidCnpj, normalizeCnpj } from './cnpj.js';

describe('CNPJ', () => {
  it('valida CNPJ numérico (formato antigo)', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('10588201000105')).toBe(true); // emitente do exemplo da NT 2014.002
  });

  it('valida o CNPJ alfanumérico de exemplo da Receita', () => {
    expect(isValidCnpj('12ABC34501DE35')).toBe(true);
  });

  it('recusa dígito verificador errado, tamanho errado e repetidos', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });

  it('exige DV numérico e minúsculas só depois de normalizar', () => {
    expect(isValidCnpj('12ABC34501DEAB')).toBe(false);
    expect(isValidCnpj('12abc34501de35')).toBe(false);
    expect(isValidCnpj(normalizeCnpj('12.abc.345/01de-35'))).toBe(true);
  });

  it('normaliza máscara e caixa', () => {
    expect(normalizeCnpj(' 11.222.333/0001-81 ')).toBe('11222333000181');
  });

  it('raiz = 8 primeiras posições (matriz e filial compartilham)', () => {
    expect(cnpjBase('11222333000181')).toBe('11222333');
    expect(cnpjBase('12ABC34501DE35')).toBe('12ABC345');
  });
});

describe('chave de acesso', () => {
  it('valida a chave real do exemplo oficial da NT', () => {
    expect(isValidAccessKey(NT_SAMPLE_ACCESS_KEY)).toBe(true);
  });

  it('recusa DV errado, tamanho errado e caractere inválido', () => {
    expect(isValidAccessKey(NT_SAMPLE_ACCESS_KEY.slice(0, 43) + '0')).toBe(false);
    expect(isValidAccessKey(NT_SAMPLE_ACCESS_KEY.slice(0, 43))).toBe(false);
    expect(isValidAccessKey('x'.repeat(44))).toBe(false);
  });

  it('aceita letras na parte do CNPJ e fecha o DV com a regra ASCII − 48', () => {
    // Monta uma chave com o CNPJ alfanumérico do emitente (posições 7–20) e calcula o DV.
    const first43 = '35' + '2610' + '12ABC34501DE35' + '55' + '001' + '000000123' + '1' + '12345678';
    expect(first43).toHaveLength(43);
    const key = first43 + accessKeyCheckDigit(first43);
    expect(isValidAccessKey(key)).toBe(true);
    expect(key.slice(6, 20)).toBe('12ABC34501DE35');
  });
});
