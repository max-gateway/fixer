import { describe, expect, it } from 'vitest';
import { firstUnresolved, invoiceSteps } from './steps';

const item = (n: number, resolution: 'UNRESOLVED' | 'MANUAL' | 'IGNORED') => ({ itemNumber: n, resolution });
const base = { status: 'FULL' as const, exportStatus: 'PENDING_MATCH' as const, postedAt: null };

describe('invoiceSteps', () => {
  it('com itens sem peça, conciliar é a etapa atual', () => {
    const s = invoiceSteps({ ...base, items: [item(1, 'MANUAL'), item(2, 'UNRESOLVED'), item(3, 'UNRESOLVED')] });
    expect(s.map((x) => x.state)).toEqual(['current', 'todo', 'todo']);
    expect(s[0]!.detail).toBe('1 de 3 vinculados');
    expect(s[1]!.detail).toBe('Depois de vincular');
  });

  it('tudo vinculado (ou ignorado): a etapa atual passa a ser precificar', () => {
    const s = invoiceSteps({ ...base, exportStatus: 'READY', items: [item(1, 'MANUAL'), item(2, 'IGNORED')] });
    expect(s.map((x) => x.state)).toEqual(['done', 'current', 'todo']);
    expect(s[0]!.detail).toBe('2 de 2 vinculados');
  });

  it('nota lançada: tudo concluído', () => {
    const s = invoiceSteps({ ...base, exportStatus: 'POSTED', postedAt: '2026-10-20T12:00:00Z', items: [item(1, 'MANUAL')] });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done']);
    expect(s[2]!.detail).toMatch(/^Lançada em /);
  });

  it('resumo, ciência e nota sem itens não têm etapas', () => {
    expect(invoiceSteps({ ...base, status: 'SUMMARY' as never, items: [] })).toEqual([]);
    expect(invoiceSteps({ ...base, items: [] })).toEqual([]);
  });
});

describe('firstUnresolved', () => {
  it('menor número entre os pendentes; null se não há', () => {
    expect(firstUnresolved([item(4, 'UNRESOLVED'), item(2, 'UNRESOLVED'), item(1, 'MANUAL')])).toBe(2);
    expect(firstUnresolved([item(1, 'MANUAL')])).toBeNull();
  });
});
