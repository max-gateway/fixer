import { addDaysIso } from './dates.js';

export interface ForecastBucket {
  key: string;
  /** Vencidas, "7 dias a partir de…" ou o que passa do horizonte. */
  kind: 'overdue' | 'week' | 'later';
  /** Primeiro e último dia (AAAA-MM-DD) cobertos; null nas pontas abertas. */
  from: string | null;
  to: string | null;
  count: number;
  /** Decimal em texto, 2 casas. */
  amount: string;
}

const fmt = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

/** Converte "123.4" / "123.45" em centavos sem passar por ponto flutuante. */
export function toCents(v: string | number | { toString(): string }): bigint {
  const [i = '0', f = ''] = String(v).split('.');
  return BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2));
}

/**
 * Saída de caixa prevista: vencidas, depois janelas de 7 dias a partir de hoje, depois "mais tarde". É sobre contas em
 * aberto; quem chama já filtrou o status. Janelas de 7 dias corridos (e não semana de calendário) para que a primeira
 * sempre responda "o que vence nos próximos 7 dias?".
 */
export function buildForecast(rows: { dueDate: string; amount: string | number | { toString(): string } }[], today: string, weeks = 8): ForecastBucket[] {
  const buckets: ForecastBucket[] = [{ key: 'overdue', kind: 'overdue', from: null, to: addDaysIso(today, -1), count: 0, amount: '0.00' }];
  for (let w = 0; w < weeks; w++) {
    buckets.push({ key: `w${w}`, kind: 'week', from: addDaysIso(today, w * 7), to: addDaysIso(today, w * 7 + 6), count: 0, amount: '0.00' });
  }
  buckets.push({ key: 'later', kind: 'later', from: addDaysIso(today, weeks * 7), to: null, count: 0, amount: '0.00' });

  const sums = buckets.map(() => 0n);
  for (const r of rows) {
    // Datas AAAA-MM-DD ordenam como texto.
    const i = buckets.findIndex((b) => (b.from === null || r.dueDate >= b.from) && (b.to === null || r.dueDate <= b.to));
    if (i < 0) continue;
    buckets[i]!.count++;
    sums[i]! += toCents(r.amount);
  }
  return buckets.map((b, i) => ({ ...b, amount: fmt(sums[i]!) }));
}
