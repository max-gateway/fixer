import { FEDERAL_LUCRO, PRESUMIDO_SURCHARGE, type RateLine } from '../data/federal-lucro.js';

const active = (l: RateLine, asOf: string) => (l.from === null || asOf >= l.from) && (l.to === null || asOf <= l.to);

/** Linhas de tributo federal vigentes na data para o regime. */
export function federalLines(regime: 'PRESUMIDO' | 'REAL', asOf: string): RateLine[] {
  return FEDERAL_LUCRO.filter((l) => l.regime === regime && active(l, asOf));
}

export interface PresumidoCommerce {
  /** Em % da receita bruta, 4 casas; o adicional do IRPJ (depende do lucro do período) não entra. */
  irpjPct: string;
  csllPct: string;
  pisPct: string;
  cofinsPct: string;
  /** Soma dos quatro. */
  totalPct: string;
  /** PIS/Cofins extintos na data (a partir de 2027): vêm zerados e o chamador deve olhar IBS/CBS. */
  pisCofinsExtinct: boolean;
}

// Tudo em centésimos de ponto percentual (inteiros); o resultado em % × 10^4.
const hundredths = (pct: string) => BigInt(pct.replace('.', ''));
const fmt = (scaled: bigint) => `${scaled / 10_000n}.${(scaled % 10_000n).toString().padStart(4, '0')}`;

/**
 * Percentual da RECEITA que o Lucro Presumido paga em IRPJ, CSLL, PIS e Cofins no comércio, na data. `aboveThreshold`
 * aplica a majoração da LC 224/2025 (presunção +10% relativo) para quem já passou dos R$ 5 milhões no ano: o chamador
 * precisa saber a receita acumulada do ano-calendário.
 */
export function presumidoCommerce(asOf: string, aboveThreshold = false): PresumidoCommerce {
  const lines = federalLines('PRESUMIDO', asOf);
  const by = (id: string) => lines.find((l) => l.id === id);
  const surcharge = aboveThreshold && asOf >= PRESUMIDO_SURCHARGE.from && (PRESUMIDO_SURCHARGE.to === null || asOf <= PRESUMIDO_SURCHARGE.to);
  const presumed = (id: string): bigint => {
    const l = by(id);
    if (!l?.presumptionPct) return 0n;
    const p = hundredths(l.presumptionPct);
    const bumped = surcharge ? (p * 110n + 50n) / 100n : p;
    return (bumped * hundredths(l.ratePct)) / 100n; // % da receita × 10^4
  };
  const flat = (id: string): bigint => (by(id) ? hundredths(by(id)!.ratePct) * 100n : 0n);
  const irpj = presumed('irpj-presumido');
  const csll = presumed('csll-presumido');
  const pis = flat('pis-cumulativo');
  const cofins = flat('cofins-cumulativo');
  return {
    irpjPct: fmt(irpj),
    csllPct: fmt(csll),
    pisPct: fmt(pis),
    cofinsPct: fmt(cofins),
    totalPct: fmt(irpj + csll + pis + cofins),
    pisCofinsExtinct: !by('pis-cumulativo') && !by('cofins-cumulativo'),
  };
}
