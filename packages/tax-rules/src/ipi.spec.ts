import { describe, expect, it } from 'vitest';
import { TIPI_LAST_UPDATE, TIPI_META, TIPI_TABLE } from '../data/tipi.js';
import { ipiRate, tipiSize } from './ipi.js';

const d = '2026-10-22';

describe('IPI pela TIPI', () => {
  it('para-choques (8708.10.00) paga 3,25%', () => {
    expect(ipiRate('8708.10.00', d)).toMatchObject({ status: 'OK', kind: 'TRIBUTADO', ratePct: '3.25', cstSaida: '50' });
    expect(ipiRate('87081000', d).ratePct).toBe('3.25');
  });

  it('pneu de automóvel de passageiros (4011.10.00) paga 9,75%', () => {
    expect(ipiRate('40111000', d)).toMatchObject({ ratePct: '9.75' });
  });

  it('cavalo reprodutor (0101.21.00) é não tributado: sem alíquota e CST 53', () => {
    expect(ipiRate('01012100', d)).toMatchObject({ status: 'OK', kind: 'NAO_TRIBUTADO', ratePct: null, cstSaida: '53' });
  });

  it('alíquota zero é diferente de não tributado: CST 51', () => {
    expect(ipiRate('84212100', d)).toMatchObject({ kind: 'ALIQUOTA_ZERO', ratePct: '0.00', cstSaida: '51' });
  });

  it('filtro de óleo (8421.23.00): 5,2% e dois ex-tarifários a 2,6%', () => {
    const base = ipiRate('84212300', d);
    expect(base.ratePct).toBe('5.20');
    expect(base.exAlternatives).toEqual([
      { ex: '1', kind: 'TRIBUTADO', ratePct: '2.60' },
      { ex: '2', kind: 'TRIBUTADO', ratePct: '2.60' },
    ]);
    expect(ipiRate('84212300', d, '1')).toMatchObject({ status: 'OK', ex: '1', ratePct: '2.60' });
    expect(ipiRate('84212300', d, '9').status).toBe('EX_NAO_ENCONTRADO');
  });

  it('ex-tarifário que na planilha vem sem NCM herda a NCM da linha anterior (bateria de íon de lítio para smartphones)', () => {
    expect(ipiRate('85076000', d).ratePct).toBe('11.25');
    expect(ipiRate('85076000', d, '1').ratePct).toBe('15.00');
    expect(ipiRate('85076000', d, 'Ex 01').ratePct).toBe('15.00');
  });

  it('linha-pai sem alíquota própria (9403.20.00): não inventa', () => {
    expect(ipiRate('94032000', d).status).toBe('NCM_SEM_ALIQUOTA');
  });

  it('NCM inválida ou inexistente; data anterior à tabela não responde', () => {
    expect(ipiRate('8708', d).status).toBe('NCM_INVALIDO');
    expect(ipiRate('99999999', d).status).toBe('NCM_INEXISTENTE');
    expect(ipiRate('87081000', '2025-12-31').status).toBe('DATA_ANTERIOR_A_TABELA');
  });

  it('a tabela é consistente', () => {
    expect(tipiSize()).toBeGreaterThan(10_500);
    const seen = new Set<string>();
    for (const line of TIPI_TABLE.split('\n')) {
      const [ncm, ex, rate] = line.split('|');
      expect(ncm, line).toMatch(/^\d{8}$/);
      expect(ex, line).toMatch(/^\d*$/);
      if (rate) expect(rate === 'NT' || (Number(rate) >= 0 && Number(rate) <= 330), line).toBe(true);
      expect(seen.has(`${ncm}|${ex}`), `duplicada: ${line}`).toBe(false);
      seen.add(`${ncm}|${ex}`);
    }
    expect(TIPI_LAST_UPDATE.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TIPI_META.effectiveFrom).toBe(TIPI_LAST_UPDATE.date);
  });
});
