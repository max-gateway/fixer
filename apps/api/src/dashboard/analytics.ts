// Funções puras de análise do dashboard: sem I/O, sem relógio, testáveis em isolamento.

/** PRNG determinístico (mulberry32): o mock é estável entre requisições e entre execuções. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : 0);
export const stdev = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export type Delta = { pct: number | null; direction: 'up' | 'down' | 'flat' };

/** Variação percentual; `null` quando não há base de comparação. Abaixo de 0,5% é "estável". */
export function delta(current: number, previous: number): Delta {
  if (previous === 0) return { pct: null, direction: current === 0 ? 'flat' : 'up' };
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return { pct: rounded, direction: Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down' };
}

/** Média móvel centrada à esquerda (janela encolhe no início da série). */
export function movingAverage(xs: readonly number[], window: number): number[] {
  return xs.map((_, i) => mean(xs.slice(Math.max(0, i - window + 1), i + 1)));
}

/** Eixo "bonito": passos de 1/2/5 × 10^n que cobrem [0, max] com ~`count` marcas. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Distribui `total` inteiros proporcionalmente a `weights` sem perder unidades (maior resto). */
export function apportion(total: number, weights: readonly number[]): number[] {
  const w = sum(weights) || 1;
  const exact = weights.map((x) => (x / w) * total);
  const out = exact.map(Math.floor);
  let left = total - sum(out);
  exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r)
    .forEach(({ i }) => {
      if (left-- > 0) out[i]!++;
    });
  return out;
}

/** Nível 0–4 por quantis dos valores não nulos (0 = vazio). Mantém contraste mesmo com outliers. */
export function quantileLevels(values: readonly number[]): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return values.map(() => 0);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const cuts = [at(0.25), at(0.5), at(0.75)];
  return values.map((v) => (v <= 0 ? 0 : 1 + cuts.filter((c) => v > c).length));
}

export type ForecastPoint = { value: number; low: number; high: number };

/**
 * Previsão sazonal-ingênua: média do mesmo dia da semana nas últimas semanas, ajustada pela
 * tendência (razão entre as duas metades da janela). A faixa é ±1,28σ (~80%) do resíduo semanal.
 */
export function seasonalForecast(
  history: readonly { weekday: number; value: number }[],
  nextWeekdays: readonly number[],
  weeks = 4,
): ForecastPoint[] {
  const recent = history.slice(-weeks * 7);
  const half = Math.floor(recent.length / 2);
  const older = mean(recent.slice(0, half).map((d) => d.value));
  const newer = mean(recent.slice(half).map((d) => d.value));
  const trend = older > 0 ? Math.min(1.25, Math.max(0.8, newer / older)) : 1;
  return nextWeekdays.map((wd) => {
    const same = recent.filter((d) => d.weekday === wd).map((d) => d.value);
    const base = mean(same) * Math.sqrt(trend);
    const band = 1.28 * stdev(same);
    return { value: base, low: Math.max(0, base - band), high: base + band };
  });
}

/** Índices cujo desvio em relação à média passa de `z` desvios-padrão. */
export function outliers(xs: readonly number[], z = 2): number[] {
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return [];
  return xs.flatMap((x, i) => (Math.abs(x - m) / s > z ? [i] : []));
}
