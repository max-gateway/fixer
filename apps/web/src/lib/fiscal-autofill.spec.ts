import { describe, expect, it } from 'vitest';
import { autofillNotices, provenanceTag, stepNotes, type AutofillReport } from './fiscal-autofill';

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

describe('stepNotes', () => {
  it('diz por que cada fonte não trouxe o valor, sem repetir o que foi pulado por regra', () => {
    const notes = stepNotes(
      report({
        steps: [
          { step: 'CNPJ_LOOKUP', status: 'OK' },
          { step: 'ISS', status: 'SEM_DADO', detail: 'A prefeitura não cadastrou a alíquota deste serviço na NFS-e Nacional.' },
          { step: 'RBT12', status: 'SEM_DADO', detail: 'O Fixer ainda não tem 12 meses de ordens de serviço.' },
          { step: 'REGIME', status: 'PULADO', detail: 'Consulta à Receita não contratada.' },
          { step: 'ICMS_VENDA', status: 'PULADO' },
        ],
      }),
    );
    expect(notes).toEqual(['ISS da prefeitura: A prefeitura não cadastrou a alíquota deste serviço na NFS-e Nacional.', 'RBT12: O Fixer ainda não tem 12 meses de ordens de serviço.']);
  });

  it('a referência da estimativa aparece na etiqueta da origem', () => {
    expect(provenanceTag({ field: 'rbt12', source: 'FIXER_ESTIMATE', confidence: 'ESTIMADO', fetchedAt: '', reference: 'OS de 10/2025 a 09/2026' })?.text).toBe('Estimativa do Fixer · OS de 10/2025 a 09/2026, estimado: confira com o contador');
  });
});
