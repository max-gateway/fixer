import { describe, expect, it } from 'vitest';
import { addMonths } from './dates.js';
import { splitAmount } from './payables.service.js';

describe('splitAmount', () => {
  it('a soma das parcelas é exatamente o total; o resto de centavos vai para a primeira', () => {
    const parts = splitAmount(100, 3);
    expect(parts).toEqual(['33.34', '33.33', '33.33']);
    expect(parts.reduce((s, p) => s + Math.round(Number(p) * 100), 0)).toBe(10000);
  });
  it('uma parcela é o próprio valor', () => expect(splitAmount(10.5, 1)).toEqual(['10.50']));
});

describe('addMonths', () => {
  it('mantém o dia e vira o ano', () => expect(addMonths('2026-11-15', 2).toISOString()).toBe('2027-01-15T00:00:00.000Z'));
  it('31/01 + 1 mês cai no último dia de fevereiro', () => expect(addMonths('2026-01-31', 1).toISOString()).toBe('2026-02-28T00:00:00.000Z'));
  it('ano bissexto', () => expect(addMonths('2028-01-31', 1).toISOString()).toBe('2028-02-29T00:00:00.000Z'));
});
