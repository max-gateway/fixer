import { describe, expect, it } from 'vitest';
import { TABLES } from '../index.js';
import { TAX_COVERAGE, taxCoverage } from './coverage.js';

describe('mapa de cobertura', () => {
  it('toda tabela citada existe no pacote', () => {
    const ids = new Set(TABLES.map((t) => t.id));
    for (const c of TAX_COVERAGE) for (const t of c.tables) expect(ids.has(t), `${c.tax}: ${t}`).toBe(true);
  });

  it('toda tabela do pacote sustenta pelo menos um tributo', () => {
    const used = new Set(TAX_COVERAGE.flatMap((c) => c.tables));
    for (const t of TABLES) expect(used.has(t.id), t.id).toBe(true);
  });

  it('cobertura parcial ou nenhuma sempre diz o que falta; completa descreve o que cobre', () => {
    for (const c of TAX_COVERAGE) {
      if (c.status === 'PARCIAL' || c.status === 'NENHUM') expect(c.gaps.length, c.tax).toBeGreaterThan(0);
      if (c.status !== 'NENHUM') expect(c.covered.length, c.tax).toBeGreaterThan(0);
      if (c.status === 'NENHUM') expect(c.tables, c.tax).toEqual([]);
    }
  });

  it('nomes únicos; os tributos do tax-engine.md §4.1 estão todos no mapa', () => {
    expect(new Set(TAX_COVERAGE.map((c) => c.tax)).size).toBe(TAX_COVERAGE.length);
    for (const tax of ['ICMS_PROPRIO', 'FCP', 'ICMS_ST', 'DIFAL', 'ANTECIPACAO_ICMS', 'IPI', 'PIS_COFINS', 'CBS_IBS', 'IMPOSTO_SELETIVO', 'ISS', 'SIMPLES', 'IRPJ_CSLL_PRESUMIDO', 'RETENCOES_NA_FONTE', 'IMPORTACAO', 'CFOP_CST_CSOSN']) {
      expect(taxCoverage(tax), tax).not.toBeNull();
    }
  });
});
