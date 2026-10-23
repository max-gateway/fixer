import { FEDERAL_LUCRO, PRESUMIDO_SURCHARGE, type RateLine } from '../data/federal-lucro.js';
import { PRESUMPTION, type PresumidoActivity } from '../data/presuncao.js';

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
 * Majoração da LC 224/2025 (presunção +10% relativo) na operação:
 *  - `false`: sem majoração (receita abaixo do limite);
 *  - `true`: majoração na operação inteira. É o teto: superestima o tributo de quem passa pouco do limite;
 *  - `{ quarterRevenueBeforeCents, operationCents }`: exato para a regra por trimestre. O acréscimo só incide sobre a parcela da
 *    receita do trimestre acima de R$ 1.250.000,00 (IN RFB 2.305/2025, art. 15, § 3º, com a IN 2.306/2026); aqui só a parte da
 *    operação que ultrapassa o limite recebe o acréscimo. Compensação entre trimestres e ajuste do último trimestre (§§ 4º e 5º)
 *    ficam com quem apura.
 */
export type PresumidoSurchargeInput = boolean | { quarterRevenueBeforeCents: bigint; operationCents: bigint };

/** Parte da operação (excedente, operação) que sofre o acréscimo: [0, op] de excedente sobre a operação. */
function surchargeSplit(input: PresumidoSurchargeInput): { excess: bigint; operation: bigint } {
  if (typeof input === 'boolean') return { excess: input ? 1n : 0n, operation: 1n };
  const { quarterRevenueBeforeCents: before, operationCents: op } = input;
  if (op <= 0n || before < 0n) throw new Error('receita do trimestre e da operação precisam ser positivas');
  const over = before + op - PRESUMIDO_SURCHARGE.quarterlyRevenueThresholdCents; // quanto do trimestre passa do limite com esta operação
  const excess = over <= 0n ? 0n : over > op ? op : over;
  return { excess, operation: op };
}

/**
 * Percentual da RECEITA que o Lucro Presumido paga em IRPJ, CSLL, PIS e Cofins no comércio, na data. `surcharge` aplica a
 * majoração da LC 224/2025 (ver `PresumidoSurchargeInput`).
 */
export function presumidoCommerce(asOf: string, surcharge: PresumidoSurchargeInput = false): PresumidoCommerce {
  return presumidoByActivity('COMERCIO_INDUSTRIA', asOf, surcharge);
}

/** Como `presumidoCommerce`, para qualquer atividade da Lei 9.249/1995, art. 15 e 20 (`data/presuncao.ts`). */
export function presumidoByActivity(activity: PresumidoActivity, asOf: string, surchargeInput: PresumidoSurchargeInput = false): PresumidoCommerce {
  const lines = federalLines('PRESUMIDO', asOf);
  const by = (id: string) => lines.find((l) => l.id === id);
  const inForce = asOf >= PRESUMIDO_SURCHARGE.from && (PRESUMIDO_SURCHARGE.to === null || asOf <= PRESUMIDO_SURCHARGE.to);
  const { excess, operation } = inForce ? surchargeSplit(surchargeInput) : { excess: 0n, operation: 1n };
  const row = PRESUMPTION.find((p) => p.activity === activity);
  if (!row) throw new Error(`atividade sem percentual de presunção: ${activity}`);
  const presumed = (id: string): bigint => {
    const l = by(id);
    if (!l?.presumptionPct) return 0n;
    const p = hundredths(id === 'csll-presumido' ? row.csllPct : row.irpjPct);
    // presunção efetiva = p × (1 + 10% × parte da operação acima do limite), arredondada a meio para cima
    const bumped = (p * (100n * operation + 10n * excess) + 50n * operation) / (100n * operation);
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

export interface PisCofinsStandard {
  pisPct: string;
  cofinsPct: string;
}

/**
 * Alíquotas-padrão de PIS e Cofins na data: cumulativo (0,65% e 3%, Presumido) ou não cumulativo (1,65% e 7,6%, Real). Devolve null
 * a partir de 2027-01-01, quando a LC 214/2025 (art. 542) extingue as duas contribuições. Regimes especiais (monofásico, alíquota
 * zero, ST) não entram aqui.
 */
export function pisCofinsStandard(regime: 'CUMULATIVO' | 'NAO_CUMULATIVO', asOf: string): PisCofinsStandard | null {
  const lines = federalLines(regime === 'CUMULATIVO' ? 'PRESUMIDO' : 'REAL', asOf);
  const pis = lines.find((l) => l.tax === 'PIS');
  const cofins = lines.find((l) => l.tax === 'COFINS');
  if (!pis || !cofins) return null;
  return { pisPct: fmt(hundredths(pis.ratePct) * 100n), cofinsPct: fmt(hundredths(cofins.ratePct) * 100n) };
}
