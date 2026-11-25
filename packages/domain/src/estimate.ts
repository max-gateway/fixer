// Estimativa de horas aprendida das observações (docs/specs/service-catalog.md §5 e §6.4).
// Funções puras: a estimativa de um nó é sempre recalculada a partir das observações, nunca
// acumulada, e é por isso que reprocessar é idempotente.

export const N_MIN = 3; // observações efetivas para um nó pré-preencher
export const SHRINKAGE_K = 3; // peso do pai no encolhimento
const MAD_MIN_SAMPLES = 5;
const MAD_THRESHOLD = 3;
const MAD_SCALE = 1.4826;
const SIGMA_FLOOR_RATIO = 0.05; // evita descartar tudo quando o MAD é 0

export interface Observation {
  id: string;
  hours: number;
  weight: number;
}

export interface ComputedEstimate {
  median: number;
  p25: number;
  p75: number;
  sampleCount: number;
  /** Identifica exatamente as observações usadas; igual => nada mudou. */
  inputsKey: string;
}

/** Menor valor cujo peso acumulado alcança q * peso total. */
function weightedQuantile(items: Array<{ x: number; w: number }>, q: number): number {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const total = sorted.reduce((s, i) => s + i.w, 0);
  let acc = 0;
  for (const item of sorted) {
    acc += item.w;
    if (acc >= q * total - 1e-9) return item.x;
  }
  return sorted[sorted.length - 1].x;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeEstimate(observations: Observation[]): ComputedEstimate | null {
  let used = observations.filter((o) => o.weight > 0 && Number.isFinite(o.hours));
  if (!used.length) return null;

  if (used.length >= MAD_MIN_SAMPLES) {
    const items = used.map((o) => ({ x: o.hours, w: o.weight }));
    const median = weightedQuantile(items, 0.5);
    const mad = weightedQuantile(items.map((i) => ({ x: Math.abs(i.x - median), w: i.w })), 0.5);
    const sigma = Math.max(mad * MAD_SCALE, Math.abs(median) * SIGMA_FLOOR_RATIO);
    used = used.filter((o) => Math.abs(o.hours - median) <= MAD_THRESHOLD * sigma);
  }

  const items = used.map((o) => ({ x: o.hours, w: o.weight }));
  const inputsKey = used
    .map((o) => `${o.id}:${o.hours}:${o.weight}`)
    .sort()
    .join('|');
  return {
    median: weightedQuantile(items, 0.5),
    p25: weightedQuantile(items, 0.25),
    p75: weightedQuantile(items, 0.75),
    sampleCount: Math.round(used.reduce((s, o) => s + o.weight, 0)),
    inputsKey,
  };
}

export interface NodeEstimate {
  variantId: string;
  level: string;
  sampleCount: number;
  median: number;
  p25: number;
  p75: number;
}

export type PickedEstimate =
  | { source: 'NONE' }
  | { source: 'LEARNED' | 'REFERENCE'; hours: number; p25: number; p75: number; level: string; sampleCount: number; variantId: string };

/**
 * `chain` vem do nó mais específico para o mais genérico (VERSION → ... → MAKE).
 * LEARNED: primeiro nó com n >= N_MIN, com encolhimento em direção ao próximo ancestral que tenha dados.
 * REFERENCE: só existem nós com 1 <= n < N_MIN; devolve o mais específico, sem encolhimento (só exibe).
 */
export function pickEstimate(chain: NodeEstimate[]): PickedEstimate {
  const withData = chain.filter((n) => n.sampleCount >= 1);
  if (!withData.length) return { source: 'NONE' };

  const idx = withData.findIndex((n) => n.sampleCount >= N_MIN);
  if (idx === -1) {
    const n = withData[0];
    return {
      source: 'REFERENCE',
      hours: round2(n.median),
      p25: round2(n.p25),
      p75: round2(n.p75),
      level: n.level,
      sampleCount: n.sampleCount,
      variantId: n.variantId,
    };
  }

  const node = withData[idx];
  const parent = withData[idx + 1];
  const blend = (own: number, up: number | undefined) =>
    round2(up === undefined ? own : (node.sampleCount * own + SHRINKAGE_K * up) / (node.sampleCount + SHRINKAGE_K));
  return {
    source: 'LEARNED',
    hours: blend(node.median, parent?.median),
    p25: blend(node.p25, parent?.p25),
    p75: blend(node.p75, parent?.p75),
    level: node.level,
    sampleCount: node.sampleCount,
    variantId: node.variantId,
  };
}
