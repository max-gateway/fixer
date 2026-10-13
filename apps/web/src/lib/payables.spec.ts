import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  describePayable,
  filtersFromParams,
  filtersToParams,
  groupRows,
  initials,
  parseMoneyInput,
  payTotal,
  relativeDue,
  sumAmounts,
  todayIso,
  type PayableRow,
} from './payables';

const TODAY = '2026-10-13';
const row = (id: string, due: string, amount: string, over: Partial<PayableRow> = {}): PayableRow => ({
  id,
  source: 'MANUAL',
  supplierName: 'Fornecedor',
  supplierCnpj: null,
  description: null,
  category: null,
  barcode: null,
  documentNumber: null,
  installment: 1,
  installmentCount: 1,
  dueDate: `${due}T00:00:00.000Z`,
  amount,
  status: 'OPEN',
  paidAt: null,
  paidAmount: null,
  interest: null,
  discount: null,
  paymentMethod: null,
  notes: null,
  invoice: null,
  ...over,
});

describe('groupRows (por vencimento)', () => {
  const rows = [
    row('a', '2026-10-01', '100.10'),
    row('b', '2026-10-13', '50.00'),
    row('c', '2026-10-14', '0.05'),
    row('d', '2026-10-18', '10.00'),
    row('e', '2026-11-05', '7.00'),
    row('f', '2027-03-01', '1.00'),
  ];
  const g = groupRows(rows, 'due', TODAY);

  it('separa em vencidas, hoje, amanhã, 7 dias, 30 dias e mais adiante, na ordem recebida', () => {
    expect(g.map((x) => x.key)).toEqual(['overdue', 'today', 'tomorrow', 'week', 'month', 'later']);
    expect(g[0]).toMatchObject({ label: 'Vencidas', tone: 'danger' });
  });
  it('subtotal em centavos exatos', () => {
    expect(g.map((x) => x.amount)).toEqual(['100.10', '50.00', '0.05', '10.00', '7.00', '1.00']);
    expect(sumAmounts(Array.from({ length: 1000 }, () => ({ amount: '0.10' })))).toBe('100.00');
  });
  it('contas pagas agrupam por mês do pagamento', () => {
    const paid = groupRows([row('p', '2026-09-30', '5.00', { status: 'PAID', paidAt: '2026-10-02T00:00:00.000Z' })], 'due', TODAY);
    expect(paid[0]!.key).toBe('m-2026-10');
  });
});

describe('groupRows (fornecedor / nenhum)', () => {
  const rows = [row('1', TODAY, '10.00', { supplierName: 'A' }), row('2', TODAY, '5.00', { supplierName: 'B' }), row('3', TODAY, '1.00', { supplierName: 'A' })];
  it('por fornecedor reúne as linhas de cada um', () => {
    const g = groupRows(rows, 'supplier', TODAY);
    expect(g.map((x) => [x.label, x.rows.length, x.amount])).toEqual([['A', 2, '11.00'], ['B', 1, '5.00']]);
  });
  it('sem agrupamento é um grupo só; vazio não gera grupo', () => {
    expect(groupRows(rows, 'none', TODAY)).toHaveLength(1);
    expect(groupRows([], 'none', TODAY)).toEqual([]);
  });
});

describe('datas e situação', () => {
  it('relativeDue', () => {
    expect(relativeDue('2026-10-13T00:00:00.000Z', TODAY)).toBe('hoje');
    expect(relativeDue('2026-10-14T00:00:00.000Z', TODAY)).toBe('amanhã');
    expect(relativeDue('2026-10-12T00:00:00.000Z', TODAY)).toBe('ontem');
    expect(relativeDue('2026-10-03T00:00:00.000Z', TODAY)).toBe('há 10 dias');
    expect(relativeDue('2026-10-20T00:00:00.000Z', TODAY)).toBe('em 7 dias');
  });
  it('describePayable', () => {
    expect(describePayable(row('x', '2026-10-10', '1'), TODAY)).toEqual({ label: 'Atrasada 3 dias', tone: 'danger' });
    expect(describePayable(row('x', '2026-10-13', '1'), TODAY)).toEqual({ label: 'Vence hoje', tone: 'warning' });
    expect(describePayable(row('x', '2026-11-30', '1'), TODAY)).toEqual({ label: 'A vencer', tone: 'outline' });
    expect(describePayable(row('x', '2026-10-01', '1', { status: 'PAID' }), TODAY).label).toBe('Paga');
  });
  it('"hoje" é o de Brasília', () => {
    expect(todayIso(new Date('2026-10-14T00:30:00Z'))).toBe('2026-10-13');
  });
});

describe('filtros ⇄ URL', () => {
  it('ida e volta preserva o que foge do padrão e omite o padrão', () => {
    const f = { ...DEFAULT_FILTERS, view: 'overdue' as const, q: 'peças', supplier: 'ACME', sort: 'amount' as const, dir: 'desc' as const, group: 'supplier' as const };
    const p = filtersToParams(f);
    expect(p.toString()).toBe('view=overdue&q=pe%C3%A7as&supplier=ACME&sort=amount&dir=desc&group=supplier');
    expect(filtersFromParams((k) => p.get(k))).toEqual(f);
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
  });
  it('valores inválidos na URL caem no padrão', () => {
    const f = filtersFromParams((k) => ({ view: 'hack', sort: 'x', from: '2026-13', group: '??' })[k as 'view']);
    expect(f).toEqual(DEFAULT_FILTERS);
  });
  it('para a API sempre leva a aba', () => {
    expect(filtersToParams(DEFAULT_FILTERS, { forApi: true }).get('view')).toBe('open');
  });
});

describe('entrada e totais', () => {
  it('parseMoneyInput aceita formatos brasileiro e internacional', () => {
    expect(parseMoneyInput('1.234,56')).toBe(1234.56);
    expect(parseMoneyInput('R$ 99,9')).toBe(99.9);
    expect(parseMoneyInput('1234.56')).toBe(1234.56);
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
  });
  it('payTotal soma juros e subtrai desconto sem erro de centavo', () => {
    expect(payTotal('0.10', 0.2, 0)).toBe(0.3);
    expect(payTotal('200.00', 12.5, 2.5)).toBe(210);
  });
  it('initials ignora sufixos societários', () => {
    expect(initials('AUTO PECAS DISTRIBUIDORA LTDA')).toBe('AP');
    expect(initials('Maria')).toBe('M');
    expect(initials('')).toBe('?');
  });
});
