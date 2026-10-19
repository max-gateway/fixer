import {
  ME_REVENUE_CAP_CENTS,
  PE_ANTECIPACAO_SIMPLES,
  PE_INTERNAL_RATE_PCT,
  PE_ST_AUTOPECAS_ORIGINS,
  type PeSimplesSize,
} from '../data/pe-icms.js';

// Regras de entrada de Pernambuco (data/pe-icms.ts). Percentuais em string com 2 casas, aritmética em bigint.

/** "71.78" -> 717800n (fração × 10^6). Aceita até 4 casas. */
function micro(pct: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(pct.trim());
  if (!m) throw new Error(`percentual inválido: ${pct}`);
  return BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0'));
}

const roundDiv = (num: bigint, den: bigint) => (num * 2n + den) / (2n * den);
/** Fração × 10^6 -> percentual com 2 casas ("107.43"). */
const pct2 = (frac: bigint) => {
  const h = roundDiv(frac, 100n); // centésimos de ponto percentual
  return `${h / 100n}.${(h % 100n).toString().padStart(2, '0')}`;
};
const ONE = 1_000_000n;

/**
 * MVA ajustada = [(1 + MVA-ST original) × (1 − ALQ inter) / (1 − ALQ intra)] − 1 (Prot. ICMS 97/2010, cláusula segunda,
 * § 1º). Se a alíquota interna for menor que a interestadual, vale a MVA original (§ 6º).
 */
export function mvaAdjusted(originalPct: string, interPct: string, intraPct: string): string {
  const m = micro(originalPct);
  const i = micro(interPct);
  const t = micro(intraPct);
  if (t < i) return pct2(m);
  return pct2(roundDiv((ONE + m) * (ONE - i), ONE - t) - ONE);
}

export type PeStOriginStatus =
  /** A UF de origem é signatária, com PE, do protocolo: o remetente retém e a nota já vem com a ST. */
  | 'REMETENTE_RETEM'
  /** Sem acordo com a UF de origem: o adquirente em PE recolhe a ST na entrada. */
  | 'ADQUIRENTE_RECOLHE'
  | 'OPERACAO_INTERNA'
  /** Antes de 2024-08-01 o regime estava no Decreto 35.679/2010, que esta tabela não cobre. */
  | 'SEM_DADO_NA_DATA';

/** Quem responde pela ST de autopeça comprada de `originUf` e entregue em PE na data `asOf`. */
export function peStAutopecasOrigin(originUf: string, asOf: string): { status: PeStOriginStatus; basis: string | null } {
  const o = originUf.toUpperCase();
  if (o === 'PE') return { status: 'OPERACAO_INTERNA', basis: null };
  const p = PE_ST_AUTOPECAS_ORIGINS.find((x) => asOf >= x.from && (x.to === null || asOf <= x.to));
  if (!p) return { status: 'SEM_DADO_NA_DATA', basis: null };
  return { status: p.retainingUfs.includes(o) ? 'REMETENTE_RETEM' : 'ADQUIRENTE_RECOLHE', basis: p.basis };
}

export type PeAntecipacaoBasis = 'REDUZIDA_ME' | 'REDUZIDA_DEMAIS' | 'DIFERENCA_ALIQUOTAS';
export type PeAntecipacaoAssumption =
  /** Sem RBT12: tratado como "demais" (percentual maior). */
  | 'PORTE_PRESUMIDO'
  /** Sem a informação de regularidade (art. 393-A): tratado como irregular (diferença cheia). */
  | 'REGULARIDADE_NAO_INFORMADA'
  /** Data sem percentual reduzido publicado (antes de 2023-12 ou a partir de 2029): diferença cheia. */
  | 'SEM_PERCENTUAL_NA_DATA';

export interface PeAntecipacaoSimples {
  pct: string;
  basis: PeAntecipacaoBasis;
  size: PeSimplesSize;
  assumptions: PeAntecipacaoAssumption[];
}

/**
 * Percentual da antecipação do ICMS na entrada interestadual para o Simples Nacional em PE, mercadoria SEM ST, à alíquota
 * interna modal. `regular` null = não informado (usa o pior caso). `rbt12Cents` null = porte desconhecido (usa "demais").
 */
export function peAntecipacaoSimples(input: { rbt12Cents: bigint | null; regular: boolean | null; interPct: '4' | '7' | '12'; asOf: string }): PeAntecipacaoSimples {
  const assumptions: PeAntecipacaoAssumption[] = [];
  const size: PeSimplesSize = input.rbt12Cents !== null && input.rbt12Cents <= ME_REVENUE_CAP_CENTS ? 'ME' : 'DEMAIS';
  if (input.rbt12Cents === null) assumptions.push('PORTE_PRESUMIDO');
  const full = pct2(micro(PE_INTERNAL_RATE_PCT) - micro(input.interPct));
  // Percentuais publicados valem de 2023-12-01 (redação atual) até 2028-12-31; em 2029 começa a redução de 20% ao ano.
  if (input.asOf < '2023-12-01' || input.asOf > '2028-12-31') {
    assumptions.push('SEM_PERCENTUAL_NA_DATA');
    return { pct: full, basis: 'DIFERENCA_ALIQUOTAS', size, assumptions };
  }
  if (input.regular !== true) {
    if (input.regular === null) assumptions.push('REGULARIDADE_NAO_INFORMADA');
    return { pct: full, basis: 'DIFERENCA_ALIQUOTAS', size, assumptions };
  }
  const pct = PE_ANTECIPACAO_SIMPLES[size][PE_INTERNAL_RATE_PCT]![input.interPct];
  return { pct, basis: size === 'ME' ? 'REDUZIDA_ME' : 'REDUZIDA_DEMAIS', size, assumptions };
}
