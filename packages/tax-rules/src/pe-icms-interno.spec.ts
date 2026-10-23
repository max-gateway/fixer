import { describe, expect, it } from 'vitest';
import { peInternalRate } from './pe-icms-interno.js';

describe('ICMS interno de PE (Lei 15.730/2016, art. 15, VII)', () => {
  it('autopeça paga a modal de 20,5% desde 2024 e 18% antes, sem FECEP', () => {
    expect(peInternalRate('87089990', '2026-10-22')).toMatchObject({ status: 'OK', ratePct: '20.50', fecepPct: '0.00' });
    expect(peInternalRate('87089990', '2023-12-31')).toMatchObject({ status: 'OK', ratePct: '18.00' });
    expect(peInternalRate('87089990', '2024-01-01').ratePct).toBe('20.50');
  });

  it('pneu de passeio também', () => {
    expect(peInternalRate('4011.10.00', '2026-10-22')).toMatchObject({ status: 'OK', ratePct: '20.50' });
  });

  it('3917.32.29 cruza o Anexo 1 (canudo plástico): a descrição do produto decide', () => {
    const r = peInternalRate('39173229', '2026-10-22');
    expect(r.status).toBe('DEPENDE');
    expect(r.note).toMatch(/canudo/);
  });

  it('mercadoria de outro segmento não recebe a modal por palpite', () => {
    expect(peInternalRate('33030010', '2026-10-22').status).toBe('FORA_DA_COBERTURA'); // perfume: 25% no Anexo 2
    expect(peInternalRate('24022000', '2026-10-22').status).toBe('FORA_DA_COBERTURA'); // cigarro: FECEP
  });

  it('data antes da tabela e NCM inválida', () => {
    expect(peInternalRate('87089990', '2019-03-31').status).toBe('DATA_SEM_TABELA');
    expect(peInternalRate('8708', '2026-10-22').status).toBe('NCM_INVALIDO');
  });
});
