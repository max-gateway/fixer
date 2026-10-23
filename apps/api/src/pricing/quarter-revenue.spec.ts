import { describe, expect, it } from 'vitest';
import { quarterRevenue, quarterStart } from './quarter-revenue.js';

const order = (closedAt: string, parts: [number, number][], services: number[] = []) => ({
  closedAt: new Date(closedAt),
  partLines: parts.map(([quantity, unitPrice]) => ({ quantity, unitPrice })),
  serviceLines: services.map((price) => ({ price, hoursActual: null })),
});

describe('receita do trimestre', () => {
  it('o trimestre começa em jan, abr, jul ou out', () => {
    expect(quarterStart(new Date('2026-10-22T12:00:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(quarterStart(new Date('2026-03-31T23:00:00Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(quarterStart(new Date('2026-06-30T12:00:00Z')).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('soma peças e mão de obra só das OS do trimestre em curso', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    const orders = [
      order('2026-09-30T12:00:00Z', [[1, 9999]]), // trimestre anterior
      order('2026-10-02T12:00:00Z', [[2, 150]], [200]), // 300 + 200
      order('2026-10-20T12:00:00Z', [], [100.5]),
      order('2026-10-25T12:00:00Z', [[1, 777]]), // depois de "agora"
    ];
    expect(quarterRevenue(now, orders).toString()).toBe('600.5');
  });

  it('sem OS, zero', () => {
    expect(quarterRevenue(new Date('2026-10-22T12:00:00Z'), []).toString()).toBe('0');
  });
});
