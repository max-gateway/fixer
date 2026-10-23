import { describe, expect, it } from 'vitest';
import { IBS_CBS_REDUCED_AUTOPECAS } from '../data/ibs-cbs-referencia.js';
import { IBS_CBS_REDUCTIONS } from '../data/ibs-cbs-reducoes.js';
import { extractCodes } from './verify/reducoes-parse.js';
import { reducedRateCandidates } from './reform.js';

describe('extractCodes', () => {
  it('lê capítulo, posição, subposição e código; NBS vai à parte', () => {
    expect(extractCodes('Café da posição 09.01 e da subposição 2101.1, ambos da NCM/SH')).toEqual({ ncm: ['0901', '21011'], nbs: [] });
    expect(extractCodes('Capítulo 31 3824.99.77 3824.99.79')).toEqual({ ncm: ['31', '38249977', '38249979'], nbs: [] });
    expect(extractCodes('1.2201.1')).toEqual({ ncm: [], nbs: ['122011'] });
    expect(extractCodes('1.2301.11.00 8708.29.99')).toEqual({ ncm: ['87082999'], nbs: ['1230111' + '00'] });
  });
});

describe('Reduções de IBS/CBS por código (LC 214, Anexos I a XV)', () => {
  it('arroz (Anexo I, item 1) é candidato a alíquota zero', () => {
    const r = reducedRateCandidates({ ncm: '1006.20.10' });
    expect(r).toContainEqual(expect.objectContaining({ annex: 'I', item: '1', reductionPct: '100', exact: false }));
  });

  it('código exato pesa mais que prefixo', () => {
    const r = reducedRateCandidates({ ncm: '10064000' });
    expect(r.find((x) => x.annex === 'I' && x.item === '1')?.exact).toBe(true);
  });

  it('serviço de ensino infantil pela NBS (Anexo II): 60%', () => {
    const r = reducedRateCandidates({ nbs: '1.2201.10.00' });
    expect(r).toContainEqual(expect.objectContaining({ annex: 'II', item: '1', reductionPct: '60' }));
  });

  it('peça comum de oficina não consta de nenhum anexo: alíquota padrão', () => {
    for (const ncm of ['87081000', '87083090', '84212300', '84099190', '40111000', '85111000', '87084090']) {
      expect(reducedRateCandidates({ ncm }), ncm).toEqual([]);
    }
  });

  it('todos os itens de autopeças já levantados à mão aparecem como candidatos', () => {
    for (const old of IBS_CBS_REDUCED_AUTOPECAS) {
      for (const ncm of old.ncm) {
        const hit = reducedRateCandidates({ ncm }).find((c) => c.annex === old.annex && c.item === old.item);
        expect(hit, `${old.annex} ${old.item} ${ncm}`).toBeDefined();
        expect(hit!.reductionPct).toBe(old.reductionPct);
      }
    }
  });

  it('código curto demais não vira candidato por acidente', () => {
    expect(reducedRateCandidates({ ncm: '10' })).toEqual([]);
    expect(reducedRateCandidates({})).toEqual([]);
  });

  it('a tabela tem os 14 anexos vigentes (o XIV foi revogado) e só 60% ou 100%', () => {
    expect(new Set(IBS_CBS_REDUCTIONS.map((i) => i.annex))).toEqual(new Set(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XV']));
    for (const it of IBS_CBS_REDUCTIONS) expect(['60', '100']).toContain(it.reductionPct);
    expect(IBS_CBS_REDUCTIONS.filter((i) => ['I', 'XII', 'XIII', 'XV'].includes(i.annex)).every((i) => i.reductionPct === '100')).toBe(true);
    expect(IBS_CBS_REDUCTIONS.filter((i) => !['I', 'XII', 'XIII', 'XV'].includes(i.annex)).every((i) => i.reductionPct === '60')).toBe(true);
  });
});
