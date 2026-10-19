import { Prisma } from '@fixer/db';
import { describe, expect, it } from 'vitest';
import { aggregateOrders, buildMetrics, categorize, closedMonths, isExpensePayable, periodOf } from './sync.js';

describe('períodos', () => {
  it('mês no fuso de Brasília: 31/10 às 22h ainda é outubro', () => {
    expect(periodOf(new Date('2026-11-01T00:30:00Z'))).toBe('2026-10');
    expect(periodOf(new Date('2026-11-01T03:30:00Z'))).toBe('2026-11');
  });

  it('os 12 meses fechados antes de hoje, sem o mês corrente', () => {
    const m = closedMonths(new Date('2026-10-19T12:00:00Z'));
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2025-10');
    expect(m[11]).toBe('2026-09');
  });
});

describe('agregação das OS', () => {
  it('peças (qtd × preço), unidades, OS, mão de obra e horas reais por mês de fechamento', () => {
    const t = aggregateOrders([
      { closedAt: new Date('2026-09-10T15:00:00Z'), partLines: [{ quantity: 2, unitPrice: '50' }, { quantity: 1, unitPrice: '30.5' }], serviceLines: [{ price: '120', hoursActual: '1.5' }] },
      { closedAt: new Date('2026-09-20T15:00:00Z'), partLines: [], serviceLines: [{ price: '80', hoursActual: null }] },
      { closedAt: new Date('2026-08-05T15:00:00Z'), partLines: [{ quantity: 4, unitPrice: '10' }], serviceLines: [] },
    ]);
    const sep = t.get('2026-09')!;
    expect(sep.partsRevenue.toString()).toBe('130.5');
    expect(sep.units.toString()).toBe('3');
    expect(sep.orders).toBe(2);
    expect(sep.servicesRevenue.toString()).toBe('200');
    expect(sep.hoursSold.toString()).toBe('1.5'); // linha sem hora real não soma
    expect(t.get('2026-08')!.partsRevenue.toString()).toBe('40');
  });
});

describe('métricas por centro', () => {
  const totals = aggregateOrders([{ closedAt: new Date('2026-09-10T15:00:00Z'), partLines: [{ quantity: 2, unitPrice: '50' }], serviceLines: [{ price: '120', hoursActual: '1.5' }] }]);

  it('peças e oficina, com o mix e as horas disponíveis (pessoas × horas)', () => {
    const m = buildMetrics(['2026-09'], totals, { paymentMix: { PIX: 60, CREDITO_1X: 40 }, mechanics: 3, hoursPerMechanic: new Prisma.Decimal(176) });
    expect(m).toEqual([
      { period: '2026-09', costCenter: 'PECAS', body: { revenue: '100', units: '2', orders: 1, productiveHours: null, availableHours: null, paymentMix: { PIX: 60, CREDITO_1X: 40 } } },
      { period: '2026-09', costCenter: 'SERVICOS', body: { revenue: '120', units: null, orders: 1, productiveHours: '1.5', availableHours: '528', paymentMix: { PIX: 60, CREDITO_1X: 40 } } },
    ]);
  });

  it('mês sem OS vai com faturamento nulo (não puxa a média para zero); sem mix nem equipe, nulos', () => {
    const m = buildMetrics(['2026-08'], totals, { paymentMix: null, mechanics: null, hoursPerMechanic: null });
    expect(m[0]!.body).toMatchObject({ revenue: null, orders: null, paymentMix: null });
    expect(m[1]!.body).toMatchObject({ revenue: null, availableHours: null });
  });
});

describe('contas pagas', () => {
  it('categoria livre vira a categoria do modelo pela palavra-chave, com acento ou sem', () => {
    expect(categorize('Aluguel do galpão')).toBe('OCUPACAO.ALUGUEL');
    expect(categorize('Conta de Luz')).toBe('OCUPACAO.ENERGIA');
    expect(categorize('Salários')).toBe('PESSOAL.SALARIOS');
    expect(categorize('Pró-labore')).toBe('PESSOAL.PRO_LABORE');
    expect(categorize('Contabilidade')).toBe('SERVICOS.CONTABILIDADE');
    expect(categorize('IPTU 2026')).toBe('TRIBUTOS.OUTROS');
    expect(categorize(null)).toBe('OUTRAS');
    expect(categorize('Diversos')).toBe('OUTRAS');
  });

  it('só despesa lançada à mão; duplicata de NF-e e ICMS de entrada ficam fora (contariam duas vezes)', () => {
    expect(isExpensePayable({ source: 'MANUAL', category: 'Aluguel' })).toBe(true);
    expect(isExpensePayable({ source: 'XML_INSTALLMENT', category: null })).toBe(false);
    expect(isExpensePayable({ source: 'XML_TOTAL', category: 'Peças' })).toBe(false);
    expect(isExpensePayable({ source: 'MANUAL', category: 'Tributos de entrada' })).toBe(false);
  });
});
