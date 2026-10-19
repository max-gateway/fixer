import { describe, expect, it } from 'vitest';
import { autofillNotices, provenanceTag, type AutofillReport } from './fiscal-autofill';

const report = (over: Partial<AutofillReport> = {}): AutofillReport => ({
  cnpj: '11222333000181',
  reset: 'NENHUM',
  steps: [{ step: 'CNPJ_LOOKUP', status: 'OK' }],
  fields: [],
  needsRegime: false,
  simplesOptant: true,
  ...over,
});

describe('provenanceTag', () => {
  it('diz a origem e destaca o que é estimado', () => {
    expect(provenanceTag({ field: 'taxRegime', source: 'CNPJ_LOOKUP', confidence: 'OFICIAL', fetchedAt: '', reference: null })).toEqual({ text: 'Receita Federal (consulta de CNPJ)', estimated: false });
    expect(provenanceTag({ field: 'lc116Item', source: 'TAX_RULES_DEFAULT', confidence: 'INFERIDO', fetchedAt: '', reference: null })?.text).toMatch(/pela CNAE/);
    expect(provenanceTag({ field: 'icmsSalePct', source: 'TAX_RULES_DEFAULT', confidence: 'ESTIMADO', fetchedAt: '', reference: null })?.estimated).toBe(true);
    expect(provenanceTag(undefined)).toBeNull();
  });
});

describe('autofillNotices', () => {
  it('nada a avisar quando tudo foi preenchido ou já batia', () => {
    expect(autofillNotices(report({ fields: [{ field: 'municipalityIbge', outcome: 'IGUAL', value: '2611606' }] }))).toEqual([]);
  });

  it('avisa conflito com valor digitado, saída do Simples e falha da consulta', () => {
    const notes = autofillNotices(
      report({
        steps: [{ step: 'CNPJ_LOOKUP', status: 'FALHOU' }],
        fields: [
          { field: 'municipalityIbge', outcome: 'CONFLITO', value: '2611606', previous: '2607901' },
          { field: 'taxRegime', outcome: 'CONFLITO', value: null, previous: 'SIMPLES' },
          { field: 'taxRegime', outcome: 'LIMPO', value: null, previous: 'SIMPLES' },
        ],
      }),
    );
    expect(notes[0]).toBe('Município (IBGE): a consulta trouxe 2611606, mas o salvo é 2607901. Mantivemos o seu valor.');
    expect(notes[1]).toMatch(/não é mais do Simples Nacional, mas o salvo é Simples Nacional/);
    expect(notes[2]).toMatch(/não consta mais como Simples Nacional/);
    expect(notes[3]).toMatch(/Não foi possível consultar a Receita/);
  });
});
