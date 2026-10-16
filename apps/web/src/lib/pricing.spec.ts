import { describe, expect, it } from 'vitest';
import { delta, marginOf, marginToMarkup, markupOf, markupToMargin, parsePrice, pct1, priceFromMarkup, roundUp } from './pricing';

describe('parsePrice', () => {
  it.each([
    ['43,90', 43.9],
    ['43.90', 43.9],
    ['1.234,56', 1234.56],
    ['R$ 80', 80],
    ['  7 ', 7],
  ])('%s → %s', (text, expected) => {
    expect(parsePrice(text)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '0', '-5', '1,2,3'])('"%s" é inválido', (text) => {
    expect(parsePrice(text)).toBeNull();
  });
});

describe('marginOf (só exibição; a API recalcula)', () => {
  it('sem imposto: (preço − custo) ÷ preço', () => {
    expect(marginOf(100, 166.67, 0, 0)).toBeCloseTo(40, 1);
  });
  it('imposto e despesa saem do preço antes do custo', () => {
    expect(marginOf(100, 166.67, 6, 4)).toBeCloseTo(30, 1);
  });
  it('preço zero não divide por zero', () => {
    expect(marginOf(100, 0, 0, 0)).toBe(0);
  });
  it('preço abaixo do custo dá margem negativa', () => {
    expect(marginOf(100, 80, 0, 0)).toBeLessThan(0);
  });
});

describe('delta e pct1', () => {
  it('variação percentual; sem base não há variação', () => {
    expect(delta('100', '125')).toBe(25);
    expect(delta('200', '150')).toBe(-25);
    expect(delta(null, '10')).toBeNull();
    expect(delta('0', '10')).toBeNull();
  });
  it('formata em pt-BR com no máximo uma casa', () => {
    expect(pct1(40.0838)).toBe('40,1%');
    expect(pct1('7')).toBe('7%');
  });
});

describe('markup e arredondamento (prévia do seletor; a API recalcula)', () => {
  it('roundUp sempre arredonda para cima, como a API', () => {
    expect(roundUp(79.01, 'CENTS_90')).toBeCloseTo(79.9, 5);
    expect(roundUp(79.9, 'CENTS_90')).toBeCloseTo(79.9, 5);
    expect(roundUp(80.0, 'CENTS_90')).toBeCloseTo(80.9, 5);
    expect(roundUp(79.01, 'CENTS_00')).toBe(80);
    expect(roundUp(41, 'MULTIPLE_5')).toBe(45);
    expect(roundUp(41, 'MULTIPLE_10')).toBe(50);
    expect(roundUp(10.001, 'NONE')).toBe(10.01);
  });

  it('roundUp não sobe um degrau por erro de ponto flutuante', () => {
    expect(100 * 1.1).toBeGreaterThan(110); // 110,00000000000001: o ponto flutuante erra para cima
    expect(roundUp(100 * 1.1, 'CENTS_00')).toBe(110);
    expect(roundUp(100 * 1.1, 'CENTS_90')).toBeCloseTo(110.9, 5);
    expect(roundUp(0.1 + 0.2, 'NONE')).toBe(0.3);
  });

  it('priceFromMarkup: custo 100 com markup 60% e preço ,90', () => {
    expect(priceFromMarkup(100, 60, 'CENTS_90')).toBeCloseTo(160.9, 5);
    expect(priceFromMarkup(100, 0, 'NONE')).toBe(100);
  });

  it('markupOf é o inverso do preço sem arredondamento', () => {
    expect(markupOf(100, 160)).toBeCloseTo(60, 5);
    expect(markupOf(0, 50)).toBe(0);
  });

  it('markup e margem se convertem sem imposto', () => {
    expect(markupToMargin(100)).toBeCloseTo(50, 5);
    expect(marginToMarkup(50)).toBeCloseTo(100, 5);
    expect(markupToMargin(marginToMarkup(37.5))).toBeCloseTo(37.5, 5);
    expect(marginToMarkup(100)).toBe(Infinity);
  });
});
