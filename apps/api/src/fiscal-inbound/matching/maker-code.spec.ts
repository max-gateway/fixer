import { describe, expect, it } from 'vitest';
import { makerCodeCandidates, partNumberKey } from './maker-code.js';

describe('makerCodeCandidates', () => {
  it('pega o código antes do hífen da descrição', () => {
    expect(makerCodeCandidates('TDI1089-TERMINAL DIRECAO VW GOL G5/VOYAGE')).toEqual(['TDI1089']);
    expect(makerCodeCandidates('BDJ1028-BANDEJA SUSP.VW GOL G5/VOYAGE/')).toEqual(['BDJ1028']);
  });

  it('aceita espaço em volta do hífen e código com hífen', () => {
    expect(makerCodeCandidates('TDI1089 - TERMINAL DIRECAO')).toEqual(['TDI1089']);
    expect(makerCodeCandidates('AB-123-AMORTECEDOR DIANTEIRO')).toEqual(['AB-123']);
  });

  it('descarta o que não parece código (sem dígito, curto demais)', () => {
    expect(makerCodeCandidates('PARAFUSO SEXTAVADO M8')).toEqual([]);
    expect(makerCodeCandidates('A1-ALGO')).toEqual([]);
    expect(makerCodeCandidates('')).toEqual([]);
  });

  it('usa a primeira palavra quando não há hífen', () => {
    expect(makerCodeCandidates('PD5361 PASTILHA FREIO')).toEqual(['PD5361']);
  });
});

describe('partNumberKey', () => {
  it('normaliza como a plataforma', () => {
    expect(partNumberKey('ab-12.3/4 x')).toBe('AB1234X');
  });
});
