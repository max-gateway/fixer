import { describe, expect, it } from 'vitest';
import { unitCost } from './cost.js';
import { nextExportStatus, resolveItems } from './resolve.js';

const item = (id: string, over: Partial<{ supplierCode: string; ean: string | null; resolution: string }> = {}) => ({
  id,
  supplierCode: `C-${id}`,
  ean: null,
  resolution: 'UNRESOLVED',
  ...over,
});

describe('resolveItems', () => {
  const maps = new Map([['C-1', { partId: 'p-map', unitFactor: '4' }]]);
  const eans = new Map([
    ['7891', ['p-ean']],
    ['7892', ['p-a', 'p-b']],
  ]);

  it('vínculo do fornecedor vence o GTIN e herda o fator', () => {
    expect(resolveItems([item('1', { ean: '7891' })], maps, eans)).toEqual([
      { itemId: '1', resolution: 'AUTO_MAP', partId: 'p-map', unitFactor: '4', learn: false },
    ]);
  });

  it('GTIN de uma peça resolve, com fator 1, e manda aprender', () => {
    expect(resolveItems([item('2', { ean: '7891' })], maps, eans)).toEqual([
      { itemId: '2', resolution: 'AUTO_EAN', partId: 'p-ean', unitFactor: '1', learn: true },
    ]);
  });

  it('GTIN ambíguo, desconhecido ou ausente não resolve', () => {
    expect(resolveItems([item('3', { ean: '7892' }), item('4', { ean: '0000' }), item('5')], maps, eans)).toEqual([]);
  });

  it('item já resolvido (ou ignorado) pelo usuário nunca é sobrescrito', () => {
    const items = [item('1', { resolution: 'MANUAL' }), item('2', { supplierCode: 'C-1', resolution: 'IGNORED' }), item('3', { supplierCode: 'C-1', resolution: 'AUTO_EAN' })];
    expect(resolveItems(items, maps, eans)).toEqual([]);
  });

  it('é determinístico: a mesma entrada dá a mesma saída', () => {
    const items = [item('1'), item('2', { ean: '7891' }), item('3', { supplierCode: 'C-1' })];
    expect(resolveItems(items, maps, eans)).toEqual(resolveItems(items, maps, eans));
  });
});

describe('nextExportStatus', () => {
  const inv = (over = {}) => ({ status: 'FULL', exportStatus: 'PENDING_MATCH' as const, needsReview: false, ...over });

  it('tudo resolvido (inclusive "não é estoque") e sem revisão: READY', () => {
    expect(nextExportStatus(inv(), ['MANUAL', 'AUTO_MAP', 'IGNORED'])).toBe('READY');
  });
  it('qualquer item sem vínculo, ou revisão pendente: PENDING_MATCH', () => {
    expect(nextExportStatus(inv(), ['MANUAL', 'UNRESOLVED'])).toBe('PENDING_MATCH');
    expect(nextExportStatus(inv({ needsReview: true }), ['MANUAL'])).toBe('PENDING_MATCH');
  });
  it('desfazer um vínculo de uma nota READY a devolve para PENDING_MATCH', () => {
    expect(nextExportStatus(inv({ exportStatus: 'READY' }), ['MANUAL', 'UNRESOLVED'])).toBe('PENDING_MATCH');
  });
  it('nota sem itens não é READY', () => {
    expect(nextExportStatus(inv(), [])).toBe('PENDING_MATCH');
  });
  it('nota lançada, anulada, sem XML ou não completa nunca é tocada', () => {
    for (const exportStatus of ['POSTED', 'VOIDED', 'NOT_READY'] as const) {
      expect(nextExportStatus(inv({ exportStatus }), ['MANUAL'])).toBeNull();
    }
    for (const status of ['SUMMARY', 'MANIFESTED', 'CANCELED', 'IGNORED']) {
      expect(nextExportStatus(inv({ status }), ['MANUAL'])).toBeNull();
    }
  });
});

describe('unitCost', () => {
  const base = { quantity: '2.0000', totalPrice: '83.80', discount: '3.00', freight: '6.05', insurance: '0', otherCosts: '0', ipi: '1.10', icmsSt: '4.20' };

  it('(vProd − desconto + frete + seguro + outras + IPI + ICMS-ST) ÷ quantidade', () => {
    // 83.80 − 3.00 + 6.05 + 1.10 + 4.20 = 92.15 ; ÷ 2 = 46.075 → 46.075 (4 casas)
    expect(unitCost(base)?.toString()).toBe('46.075');
  });

  it('divide pela quantidade em unidades de ESTOQUE (quantidade × fator)', () => {
    // caixa com 4 peças: 92.15 ÷ (2 × 4) = 11.51875 → 11.5188
    expect(unitCost(base, 4)?.toString()).toBe('11.5188');
  });

  it('não sofre de ponto flutuante (0.1 + 0.2)', () => {
    const c = unitCost({ ...base, quantity: '1', totalPrice: '0.1', discount: '0', freight: '0.2', ipi: '0', icmsSt: '0' });
    expect(c?.toString()).toBe('0.3');
  });

  it('quantidade zero não tem custo', () => {
    expect(unitCost({ ...base, quantity: '0' })).toBeNull();
    expect(unitCost(base, 0)).toBeNull();
  });

  it('o ST retido anteriormente (ICMS60) não entra: o parser o deixa em 0', () => {
    expect(unitCost({ ...base, ipi: '0', icmsSt: '0', freight: '0', discount: '0' })?.toString()).toBe('41.9');
  });
});
