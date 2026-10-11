import { describe, expect, it } from 'vitest';
import { computeEstimate, N_MIN, pickEstimate, type NodeEstimate } from './estimate.js';

const obs = (hours: number[], weight = 1) => hours.map((h, i) => ({ id: `o${i}`, hours: h, weight }));

describe('computeEstimate', () => {
  it('sem observações devolve null', () => {
    expect(computeEstimate([])).toBeNull();
  });

  it('mediana e quartis de uma amostra simples', () => {
    const e = computeEstimate(obs([3, 4, 5]))!;
    expect(e).toMatchObject({ median: 4, p25: 3, p75: 5, sampleCount: 3 });
  });

  it('é independente da ordem das observações', () => {
    const a = computeEstimate(obs([5, 3, 4, 6, 4]).map((o, i) => ({ ...o, id: `x${i}` })))!;
    const shuffled = obs([4, 6, 3, 4, 5]).map((o, i) => ({ ...o, id: `x${i}` }));
    // mesmas horas, ids diferentes: estatísticas iguais
    expect(computeEstimate(shuffled)).toMatchObject({ median: a.median, p25: a.p25, p75: a.p75 });
  });

  it('descarta outlier por MAD só com 5 ou mais observações', () => {
    const e = computeEstimate(obs([4, 4, 4, 4, 40]))!;
    expect(e.median).toBe(4);
    expect(e.p75).toBe(4);
    expect(e.sampleCount).toBe(4); // o outlier não conta
    const few = computeEstimate(obs([4, 4, 4, 40]))!;
    expect(few.sampleCount).toBe(4); // com n < 5 nada é descartado
  });

  it('observações de peso baixo contam menos no sampleCount e na mediana', () => {
    const e = computeEstimate([
      { id: 'a', hours: 4, weight: 1 },
      { id: 'b', hours: 4, weight: 1 },
      { id: 'c', hours: 8, weight: 0.25 },
    ])!;
    expect(e.median).toBe(4);
    expect(e.sampleCount).toBe(2); // round(2.25)
  });

  it('aceites sem edição (peso 0.25) pesam menos que medições editadas', () => {
    const edited = [3.5, 4, 4.5].map((h, i) => ({ id: `e${i}`, hours: h, weight: 1 }));
    const accepted = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, hours: 6, weight: 0.25 }));
    const e = computeEstimate([...edited, ...accepted])!;
    expect(e.median).toBe(4.5); // com peso 1 para todos seria 6
    expect(e.sampleCount).toBe(5); // 3 + 8 * 0.25
  });

  it('inputsKey é determinístico e muda quando uma observação muda', () => {
    const a = computeEstimate(obs([3, 4, 5]))!;
    const b = computeEstimate([...obs([3, 4, 5])].reverse())!;
    expect(a.inputsKey).toBe(b.inputsKey);
    expect(computeEstimate(obs([3, 4, 6]))!.inputsKey).not.toBe(a.inputsKey);
  });

  it('inputsKey contém só as observações que entraram no cálculo (sem os outliers descartados)', () => {
    expect(computeEstimate(obs([4, 4, 4, 4, 40]))!.inputsKey).toBe(computeEstimate(obs([4, 4, 4, 4]))!.inputsKey);
  });
});

const node = (level: NodeEstimate['level'], n: number, median: number, spread = 1): NodeEstimate => ({
  variantId: level,
  level,
  sampleCount: n,
  median,
  p25: median - spread,
  p75: median + spread,
});

describe('pickEstimate', () => {
  it('sem nenhuma observação na cadeia → NONE', () => {
    expect(pickEstimate([])).toEqual({ source: 'NONE' });
  });

  it('usa o primeiro nó (mais específico) com n >= N_MIN → LEARNED', () => {
    const r = pickEstimate([node('FAMILY', N_MIN, 4), node('MODEL', 10, 6)]);
    expect(r).toMatchObject({ source: 'LEARNED', level: 'FAMILY', sampleCount: N_MIN });
  });

  it('aplica shrinkage em direção ao pai: h = (n·h_nó + k·h_pai) / (n + k)', () => {
    const r = pickEstimate([node('FAMILY', 3, 4), node('MODEL', 10, 7)]);
    // (3*4 + 3*7) / 6 = 5.5
    expect(r).toMatchObject({ source: 'LEARNED', hours: 5.5 });
  });

  it('sem pai com estimativa usa o valor do próprio nó', () => {
    expect(pickEstimate([node('MODEL', 3, 4)])).toMatchObject({ source: 'LEARNED', hours: 4, p25: 3, p75: 5 });
  });

  it('nó específico com poucas observações é ignorado quando um ancestral qualifica', () => {
    const r = pickEstimate([node('FAMILY', 2, 9), node('MODEL', 5, 4)]);
    expect(r).toMatchObject({ source: 'LEARNED', level: 'MODEL', hours: 4 });
  });

  it('só nós com 1 <= n < N_MIN → REFERENCE (o mais específico), sem shrinkage', () => {
    const r = pickEstimate([node('FAMILY', 1, 4.5), node('MODEL', 2, 6)]);
    expect(r).toMatchObject({ source: 'REFERENCE', level: 'FAMILY', hours: 4.5, sampleCount: 1 });
  });

  it('ignora nós com n = 0', () => {
    expect(pickEstimate([node('FAMILY', 0, 4)])).toEqual({ source: 'NONE' });
  });

  it('arredonda as horas a 2 casas', () => {
    // (3*4.1 + 3*5.333) / 6 = 4.7165
    expect(pickEstimate([node('FAMILY', 3, 4.1), node('MODEL', 4, 5.333)])).toMatchObject({ hours: 4.72 });
  });
});
