import { describe, expect, it } from 'vitest';
import { breakEvenPrice, changesSince, priceShares, type EntryContext } from './entries';
import type { PricingRowView } from './pricing';

const then: EntryContext = {
  cost: { unit: '23.2', regime: 'SIMPLES', components: [] },
  price: { outcome: 'APPLIED', before: '40', after: '43.9', suggested: '43.9', marginPct: '41', rule: { method: 'MARGIN', value: '35', overheadPct: '0', minMarginPct: '10' } },
  saleTax: { pct: '7', confidence: 'ESTIMADO' },
};
const now = (o: Partial<Pick<PricingRowView, 'cost' | 'rule' | 'saleTax'>> = {}): Pick<PricingRowView, 'cost' | 'rule' | 'saleTax'> => ({
  cost: '23.2',
  rule: { method: 'MARGIN', value: '35', overheadPct: '0', rounding: 'CENTS_90', minMarginPct: '10', maxJumpPct: '25' },
  saleTax: { pct: '7', confidence: 'ESTIMADO', unavailable: null, components: [] },
  ...o,
});

describe('changesSince', () => {
  it('nada mudou: lista vazia', () => {
    expect(changesSince(then, now())).toEqual([]);
  });

  it('explica em português cada diferença entre o lançamento e o cálculo de hoje', () => {
    const out = changesSince(
      then,
      now({
        cost: '25',
        rule: { method: 'MARGIN', value: '40', overheadPct: '3', rounding: 'CENTS_90', minMarginPct: '10', maxJumpPct: '25' },
        saleTax: { pct: '10', confidence: 'CONFIRMADO', unavailable: null, components: [] },
      }),
    );
    expect(out).toEqual([
      'regra de preço: margem 35% → margem 40%',
      'despesas na regra: 0% → 3%',
      'imposto sobre a venda: 7% → 10%',
      'confiança do imposto: estimado → confirmado',
      expect.stringMatching(/^custo desta compra: R\$\s?23,20 → R\$\s?25,00$/),
    ]);
  });

  it('regra criada ou removida depois do lançamento', () => {
    expect(changesSince({ ...then, price: { ...then.price!, rule: null } }, now())).toEqual(['regra de preço criada: margem 35%']);
    expect(changesSince(then, now({ rule: null }))).toEqual(['a regra de preço foi removida']);
  });
});

describe('priceShares / breakEvenPrice', () => {
  it('de cada R$ 100: custo, imposto, despesas e o que sobra', () => {
    expect(priceShares(160, 100, 6, 4)).toEqual({ cost: 62.5, tax: 6, overhead: 4, margin: 27.5 });
    expect(priceShares(100, 100, 6, 0)!.margin).toBe(-6); // prejuízo
    expect(priceShares(0, 100, 6, 0)).toBeNull();
  });

  it('preço que só cobre custo, imposto e despesas; e o da margem mínima', () => {
    expect(breakEvenPrice(100, 10, 0)).toBeCloseTo(111.11, 2);
    expect(breakEvenPrice(100, 10, 0, 20)).toBeCloseTo(142.86, 2);
    expect(breakEvenPrice(100, 60, 40)).toBeNull();
  });
});
