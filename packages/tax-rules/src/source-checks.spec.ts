import { describe, expect, it } from 'vitest';
import { nextStamps, renderStamps, sourceCheck } from './source-checks.js';

const tables = [
  { id: 'a', version: '2' },
  { id: 'b', version: '1' },
  { id: 'c', version: '1' },
];
const prev = { b: { version: '1', checkedAt: '2026-01-01', checks: ['b'] }, c: { version: '1', checkedAt: '2026-01-01', checks: ['c'] } };

describe('conferência com a fonte oficial', () => {
  it('PASS carimba hoje; FAIL ou WARN derruba; ERROR mantém o anterior', () => {
    const out = nextStamps(
      [
        { id: 'a1', table: 'a', status: 'PASS' },
        { id: 'a2', table: 'a + b', status: 'PASS' },
        { id: 'b1', table: 'b', status: 'WARN' },
        { id: 'c', table: 'c', status: 'ERROR' },
      ],
      tables,
      prev,
      '2026-10-19',
    );
    expect(out).toEqual({ a: { version: '2', checkedAt: '2026-10-19', checks: ['a1', 'a2'] }, c: prev.c });
  });

  it('tabela que não rodou nesta vez mantém o carimbo anterior', () => {
    expect(nextStamps([], tables, prev, '2026-10-19')).toEqual(prev);
  });

  it('carimbo só vale para a versão conferida', () => {
    expect(sourceCheck({ id: 'b', version: '1' }, prev)).toEqual(prev.b);
    expect(sourceCheck({ id: 'b', version: '2' }, prev)).toBeNull();
  });

  it('gera o arquivo de dados', () => {
    expect(renderStamps(prev)).toContain("'b': { version: '1', checkedAt: '2026-01-01', checks: ['b'] },");
  });
});
