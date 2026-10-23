import { describe, expect, it } from 'vitest';
import type { ItemCost } from './invoice-cost';
import { formatCest, formatNcm, invoiceNotices, invoiceTaxes, itemFiscalFacts } from './invoice-view';

const cost = (components: ItemCost['components']): ItemCost => ({ landed: '10', total: '100', profile: 'RESALE', components });
const comp = (code: ItemCost['components'][number]['code'], amount: string, treatment: ItemCost['components'][number]['treatment']) => ({ code, amount, treatment, source: 'XML', allocated: false });

describe('invoiceTaxes', () => {
  const items = [
    { itemNumber: 1, totalPrice: '100.00', cost: cost([comp('PRODUTO', '100', 'COST'), comp('ICMS_PROPRIO', '18', 'INFO'), comp('IPI', '5', 'COST'), comp('FRETE', '4', 'COST')]) },
    { itemNumber: 2, totalPrice: '50.00', cost: cost([comp('ICMS_PROPRIO', '9', 'INFO'), comp('CREDITO_ICMS', '-9', 'CREDIT'), comp('ICMS_ST', '6', 'COST')]) },
  ];
  it('soma cada imposto entre os itens e ignora o que não é imposto', () => {
    const t = invoiceTaxes(items);
    expect(t.slices.map((s) => [s.code, s.amount])).toEqual([['ICMS_PROPRIO', 27], ['CREDITO_ICMS', 9], ['ICMS_ST', 6], ['IPI', 5]]);
    expect(t.total).toBe(47);
    expect(t.base).toBe(150);
    expect(t.byTreatment).toEqual({ COST: 11, CREDIT: 9, INFO: 27 });
  });
  it('filtra por item', () => {
    const t = invoiceTaxes(items, 2);
    expect(t.base).toBe(50);
    expect(t.slices.some((s) => s.code === 'IPI')).toBe(false);
  });
  it('sem custo calculado não há fatias', () => {
    expect(invoiceTaxes([{ itemNumber: 1, totalPrice: '10', cost: null }]).slices).toEqual([]);
  });
});

describe('invoiceNotices', () => {
  const base = { status: 'FULL', exportStatus: 'PENDING_MATCH', needsReview: false, finality: 1, ignoredReason: null, manifestError: null, manifestAttempts: 0, postedAt: null } as const;
  it('uma nota pronta traz um aviso só, o mesmo para o painel e a página', () => {
    const n = invoiceNotices({ ...base, exportStatus: 'READY' });
    expect(n.map((x) => x.id)).toEqual(['ready']);
  });
  it('erro de ciência vem antes do aviso de resumo', () => {
    const n = invoiceNotices({ ...base, status: 'SUMMARY', manifestError: 'x', manifestAttempts: 5 });
    expect(n.map((x) => x.id)).toEqual(['manifest-error', 'summary']);
    expect(n[0]!.detail).toContain('Esgotadas');
  });
  it('nota que precisa de revisão cita a finalidade', () => {
    expect(invoiceNotices({ ...base, exportStatus: 'READY', needsReview: true, finality: 4 })[0]!.title).toContain('Devolução');
  });
});

describe('dados fiscais do item', () => {
  it('formata NCM e CEST e mantém o que já vem formatado', () => {
    expect(formatNcm('87089990')).toBe('8708.99.90');
    expect(formatNcm('8708')).toBe('8708');
    expect(formatCest('0100300')).toBe('01.003.00');
  });
  it('lista NCM, CEST, CFOP e GTIN, sem campo vazio', () => {
    expect(itemFiscalFacts({ ncm: '87089990', cest: null, cfop: '5102', ean: null }).map((f) => f.label)).toEqual(['NCM', 'CFOP']);
    expect(itemFiscalFacts({ ncm: '87089990', cest: '0100300', cfop: '5405', ean: '789' }).map((f) => f.label)).toEqual(['NCM', 'CEST', 'CFOP', 'GTIN']);
  });
});
