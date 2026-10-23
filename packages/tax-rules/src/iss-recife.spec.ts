import { describe, expect, it } from 'vitest';
import { issRate } from './iss-recife.js';

describe('ISS do Recife', () => {
  it('manutenção de veículo (14.01) paga 5%', () => {
    expect(issRate('2611606', '14.01', '2026-10-22')).toEqual({ status: 'OK', ratePct: '5.00', effectivePct: '5.0000', transitionRemainingPct: '100' });
  });

  it('funilaria e guincho também: demais serviços', () => {
    expect(issRate('2611606', '14.12', '2026-10-22').ratePct).toBe('5.00');
    expect(issRate('2611606', '14.14', '2026-10-22').ratePct).toBe('5.00');
  });

  it('item 4 (saúde) tem alíquotas próprias que o pacote não tem', () => {
    expect(issRate('2611606', '4.02', '2026-10-22').status).toBe('SEM_REGRA');
  });

  it('em 2030 o ISS vale 80% da alíquota de 2028', () => {
    expect(issRate('2611606', '14.01', '2030-06-01')).toMatchObject({ ratePct: '5.00', effectivePct: '4.0000', transitionRemainingPct: '80' });
  });

  it('em 2033 a LC 116 acabou', () => {
    expect(issRate('2611606', '14.01', '2033-01-01').status).toBe('FORA_DE_VIGENCIA');
  });

  it('outro município, subitem inexistente ou vetado não recebem palpite', () => {
    expect(issRate('3550308', '14.01', '2026-10-22').status).toBe('MUNICIPIO_NAO_COBERTO');
    expect(issRate('2611606', '99.99', '2026-10-22').status).toBe('SUBITEM_INEXISTENTE');
    expect(issRate('2611606', '7.14', '2026-10-22').status).toBe('SUBITEM_REVOGADO');
  });

  it('IBGE com dígito verificador de 7 posições é aceito', () => {
    expect(issRate('2611606', '14.01', '2026-10-22').status).toBe('OK');
    expect(issRate('26116060', '14.01', '2026-10-22').status).toBe('OK');
  });
});
