import { SIMPLES_COMERCIO, type SimplesBracket, type SimplesPeriod, type SimplesShare } from '../data/simples-comercio.js';
import { SIMPLES_SERVICOS_ANEXO_III, type ServicoShare } from '../data/simples-servicos.js';

// Alíquota efetiva do Simples Nacional, Anexo I (comércio): (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12
// (LC 123/2006, art. 18, § 1º). Aritmética em bigint para não depender de ponto flutuante nem de biblioteca decimal;
// as saídas são strings com 4 casas, prontas para `new Prisma.Decimal(...)`. A tabela muda em 2027 (LC 214/2025,
// Anexo XVIII), então toda consulta leva a data.

export interface SimplesRate {
  periodId: string;
  bracket: SimplesBracket['bracket'];
  /** Alíquota efetiva, em %. */
  effectivePct: string;
  /** Cada tributo da repartição, em % da RECEITA (já multiplicado pela alíquota efetiva). */
  components: SimplesShare;
}

const today = () => new Date().toISOString().slice(0, 10);

/** "1234567.89" -> 123456789n. Aceita só dígitos com até 2 casas; qualquer outra coisa devolve null. */
export function parseCents(value: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}

export const roundDiv = (num: bigint, den: bigint) => (num * 2n + den) / (2n * den); // meio para cima, num e den positivos

/** Valor escalado por 10^4 -> "12.3456". */
export const fmt4 = (scaled: bigint) => `${scaled / 10_000n}.${(scaled % 10_000n).toString().padStart(4, '0')}`;

/** "14.30" -> 1430n (centésimos de ponto percentual). */
export const hundredths = (pct: string) => BigInt(pct.replace('.', ''));

export function simplesPeriodFor(asOf: string): SimplesPeriod | null {
  return SIMPLES_COMERCIO.find((p) => asOf >= p.from && (p.to === null || asOf <= p.to)) ?? null;
}

export function simplesBracketFor(rbt12Cents: bigint, asOf: string = today()): SimplesBracket | null {
  if (rbt12Cents <= 0n) return null;
  return simplesPeriodFor(asOf)?.brackets.find((b) => rbt12Cents <= b.upToCents) ?? null;
}

/**
 * Alíquota efetiva e repartição para uma RBT12 em reais ("1234567.89") na data `asOf` (AAAA-MM-DD). Devolve null
 * quando a RBT12 é inválida, não positiva, acima do teto do Simples (R$ 4,8 milhões) ou a data não tem tabela.
 */
export function simplesRate(rbt12: string, asOf: string = today()): SimplesRate | null {
  const rbt = parseCents(rbt12);
  if (rbt === null) return null;
  const period = simplesPeriodFor(asOf);
  const b = period && simplesBracketFor(rbt, asOf);
  if (!period || !b) return null;

  // pct × 10^4 = (rbt × nominal − dedução) / rbt × 10^4, com nominal em centésimos de % e valores em centavos.
  const numerator = rbt * hundredths(b.nominalPct) - b.deductionCents * 10_000n;
  const effScaled = roundDiv(numerator * 100n, rbt);
  const part = (sharePct: string) => fmt4(roundDiv(effScaled * hundredths(sharePct), 10_000n));

  const s = b.share;
  return {
    periodId: period.id,
    bracket: b.bracket,
    effectivePct: fmt4(effScaled),
    components: { irpj: part(s.irpj), csll: part(s.csll), cofins: part(s.cofins), pis: part(s.pis), cbs: part(s.cbs), cpp: part(s.cpp), icms: part(s.icms), ibs: part(s.ibs) },
  };
}

export interface ServicoRate {
  periodId: string;
  bracket: 1 | 2 | 3 | 4;
  /** Alíquota efetiva, em %. */
  effectivePct: string;
  /** Cada tributo da repartição, em % da RECEITA (já multiplicado pela alíquota efetiva). */
  components: ServicoShare;
}

/**
 * @deprecated Use `simplesNacional('III', ...)` (src/simples-nacional.ts): cobre as 6 faixas, o teto do ISS e 2027 em diante, e é
 * conferido contra a lei por `verify:sources`. Esta função fica só até os consumidores migrarem.
 *
 * Anexo III (serviços): alíquota efetiva e repartição para a RBT12 na data `asOf`. Devolve null fora do que a tabela cobre
 * (RBT12 inválida, acima de R$ 1,8 milhão, ou data fora de 2018-01-01..2026-12-31). Ver data/simples-servicos.ts: tabela ainda
 * sem carimbo de conferência oficial.
 */
export function simplesServicoRate(rbt12: string, asOf: string = today()): ServicoRate | null {
  const rbt = parseCents(rbt12);
  const t = SIMPLES_SERVICOS_ANEXO_III;
  if (rbt === null || rbt <= 0n || asOf < t.from || asOf > t.to) return null;
  const b = t.brackets.find((x) => rbt <= x.upToCents);
  if (!b) return null;
  const effScaled = roundDiv((rbt * hundredths(b.nominalPct) - b.deductionCents * 10_000n) * 100n, rbt);
  const part = (sharePct: string) => fmt4(roundDiv(effScaled * hundredths(sharePct), 10_000n));
  const s = b.share;
  return {
    periodId: t.id,
    bracket: b.bracket,
    effectivePct: fmt4(effScaled),
    components: { irpj: part(s.irpj), csll: part(s.csll), cofins: part(s.cofins), pis: part(s.pis), cpp: part(s.cpp), iss: part(s.iss) },
  };
}

