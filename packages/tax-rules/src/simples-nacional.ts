import { SIMPLES_ANEXOS, type AnnexBracket, type AnnexPeriod, type SimplesTaxKey } from '../data/simples-anexos.js';
import { SIMPLES_COMERCIO } from '../data/simples-comercio.js';
import { fmt4, hundredths, parseCents, roundDiv } from './simples.js';

// Simples Nacional, Anexos I a V, num só cálculo (LC 123/2006, art. 18, com a LC 155/2016; Anexos XVIII a XXII da LC 214/2025 a
// partir de 2027). Aritmética em bigint; toda consulta leva a data.
//
//  - alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12            (art. 18, § 1º-A)
//  - cada tributo = efetiva × percentual de repartição                                     (§ 1º-B)
//  - ISS limitado ao teto da 5ª faixa, com o excedente repartido pelos demais              (§ 1º-B, I)
//  - diferença de arredondamento vai ao tributo de maior repartição da faixa               (§ 1º-B, II)

export type SimplesAnnex = 'I' | 'II' | 'III' | 'IV' | 'V';

export const SIMPLES_TAX_KEYS: SimplesTaxKey[] = ['irpj', 'csll', 'cofins', 'pis', 'cbs', 'cpp', 'ipi', 'icms', 'iss', 'ibs'];

/** Sublimite estadual de ICMS e ISS na regra geral (LC 123, art. 19); UFs podem adotar menor. */
export const SIMPLES_GENERAL_SUBLIMIT_CENTS = 360_000_000n;

/** Limite do Simples (LC 123, art. 3º, II). */
export const SIMPLES_CEILING_CENTS = 480_000_000n;

export type SimplesNacionalComponents = Record<SimplesTaxKey, string>;

export interface SimplesNacionalRate {
  periodId: string;
  annex: SimplesAnnex;
  bracket: AnnexBracket['bracket'];
  nominalPct: string;
  /** Alíquota efetiva, em %, 4 casas. */
  effectivePct: string;
  /** Cada tributo em % da RECEITA (já multiplicado pela efetiva). A soma é a efetiva (exceto o que sai do DAS: ver `dasPct`). */
  components: SimplesNacionalComponents;
  /** O teto do ISS limitou o ISS da 5ª faixa (excedente repartido pelos demais). */
  issCapApplied: boolean;
  /** Anexo IV: a CPP não está no DAS, é recolhida à parte (art. 18, § 5º-C). */
  cppOutsideDas: boolean;
  /** ICMS e ISS saem do DAS: RBT12 acima do sublimite estadual (ou 6ª faixa, onde a tabela já não os traz). */
  stateTaxesOutsideDas: boolean;
  /** Percentual da receita efetivamente pago no DAS, 4 casas: a efetiva menos ICMS e ISS quando saem do DAS. */
  dasPct: string;
}

export interface SimplesNacionalOptions {
  /** Sublimite de ICMS e ISS da UF/município em centavos. Padrão: R$ 3,6 milhões. */
  stateSublimitCents?: bigint;
}

/** Anexo I (comércio) no mesmo formato dos demais, para um único cálculo. */
const ANEXO_I: AnnexPeriod[] = SIMPLES_COMERCIO.map((p) => ({
  id: p.id,
  annex: 'I' as const,
  from: p.from,
  to: p.to,
  source: p.source,
  issCap: null,
  brackets: p.brackets.map((b) => ({
    bracket: b.bracket,
    upToCents: b.upToCents,
    nominalPct: b.nominalPct,
    deductionCents: b.deductionCents,
    share: { ...b.share, ipi: '0.00', iss: '0.00' },
  })),
}));

const ALL: AnnexPeriod[] = [...ANEXO_I, ...SIMPLES_ANEXOS];

export function simplesAnnexPeriod(annex: SimplesAnnex, asOf: string): AnnexPeriod | null {
  return ALL.find((p) => p.annex === annex && asOf >= p.from && (p.to === null || asOf <= p.to)) ?? null;
}

/**
 * Cálculo do Simples Nacional para a RBT12 em reais ("1234567.89") na data `asOf` (AAAA-MM-DD). Devolve null quando a RBT12 é
 * inválida, não positiva, acima de R$ 4,8 milhões ou não há tabela para a data.
 */
export function simplesNacional(annex: SimplesAnnex, rbt12: string, asOf: string, options: SimplesNacionalOptions = {}): SimplesNacionalRate | null {
  const rbt = parseCents(rbt12);
  if (rbt === null || rbt <= 0n || rbt > SIMPLES_CEILING_CENTS) return null;
  const period = simplesAnnexPeriod(annex, asOf);
  const b = period?.brackets.find((x) => rbt <= x.upToCents);
  if (!period || !b) return null;

  const eff = roundDiv((rbt * hundredths(b.nominalPct) - b.deductionCents * 10_000n) * 100n, rbt); // % × 10^4
  const part = (pctShare: string, base = eff) => roundDiv(base * hundredths(pctShare), 10_000n);

  const comp = Object.fromEntries(SIMPLES_TAX_KEYS.map((k) => [k, 0n])) as Record<SimplesTaxKey, bigint>;
  let weights: Record<SimplesTaxKey, string> = b.share;
  let issCapApplied = false;

  const cap = period.issCap;
  const issUncapped = part(b.share.iss);
  if (cap && b.bracket === cap.bracket && issUncapped > hundredths(cap.issPct) * 100n) {
    issCapApplied = true;
    const capScaled = hundredths(cap.issPct) * 100n;
    const excess = eff - capScaled;
    for (const k of SIMPLES_TAX_KEYS) comp[k] = k === 'iss' ? capScaled : part(cap.share[k], excess);
    weights = { ...cap.share, iss: '0.00' };
  } else {
    for (const k of SIMPLES_TAX_KEYS) comp[k] = part(b.share[k]);
  }

  // Resíduo de arredondamento (art. 18, § 1º-B, II): vai ao tributo de maior repartição da faixa.
  const residual = eff - SIMPLES_TAX_KEYS.reduce((acc, k) => acc + comp[k], 0n);
  if (residual !== 0n) {
    const top = SIMPLES_TAX_KEYS.reduce((best, k) => (hundredths(weights[k]) > hundredths(weights[best]) ? k : best), SIMPLES_TAX_KEYS[0]!);
    comp[top] += residual;
  }

  const sublimit = options.stateSublimitCents ?? SIMPLES_GENERAL_SUBLIMIT_CENTS;
  const stateOut = rbt > sublimit;
  const stateTaxes = comp.icms + comp.iss;
  return {
    periodId: period.id,
    annex,
    bracket: b.bracket,
    nominalPct: b.nominalPct,
    effectivePct: fmt4(eff),
    components: Object.fromEntries(SIMPLES_TAX_KEYS.map((k) => [k, fmt4(comp[k])])) as SimplesNacionalComponents,
    issCapApplied,
    cppOutsideDas: annex === 'IV',
    stateTaxesOutsideDas: stateOut,
    dasPct: fmt4(stateOut ? eff - stateTaxes : eff),
  };
}

export interface FatorR {
  /** Folha ÷ receita, em %, 4 casas. */
  ratioPct: string;
  /** Anexo III quando a razão é igual ou superior a 28%, senão Anexo V (LC 123, art. 18, §§ 5º-J e 5º-M). */
  annex: 'III' | 'V';
}

/**
 * Fator R: razão entre a folha de salários e a receita bruta dos 12 meses anteriores. Ambos em reais ("1234.56"). O conceito de
 * folha (salários, pró-labore, encargos, FGTS) é de quem chama. Devolve null com entrada inválida ou receita não positiva.
 */
export function simplesFatorR(payroll12: string, rbt12: string): FatorR | null {
  const folha = parseCents(payroll12);
  const rbt = parseCents(rbt12);
  if (folha === null || rbt === null || rbt <= 0n) return null;
  return { ratioPct: fmt4(roundDiv(folha * 1_000_000n, rbt)), annex: folha * 100n >= 28n * rbt ? 'III' : 'V' };
}

export interface SimplesReductions {
  /** ICMS já recolhido por ST ou antecipação com encerramento de tributação (art. 18, § 4º-A, I). */
  icmsAlreadyPaid?: boolean;
  /** Receita de tributação monofásica de PIS/Cofins (§ 4º-A, I). Só até 2026: a partir de 2027 não há regra nos textos lidos. */
  pisCofinsMonophasic?: boolean;
  /** ISS retido na fonte ou devido a outro município (§ 4º-A, II e V). */
  issWithheld?: boolean;
}

export type SimplesDasStatus = 'OK' | 'MONOFASICO_2027_SEM_REGRA';

export interface SimplesDas {
  status: SimplesDasStatus;
  /** % da receita pago no DAS depois das reduções, 4 casas; null quando o status não é OK. */
  dasPct: string | null;
  removed: SimplesTaxKey[];
}

/**
 * Percentual do DAS depois de tirar as parcelas já recolhidas por outro meio (art. 18, §§ 4º-A, 12 e 13). Parte do `dasPct` do
 * cálculo, então já respeita o sublimite. Monofásico a partir de 2027: a repartição troca PIS/Cofins por CBS e a lei remete a
 * regulamentação, então não há número: devolve `MONOFASICO_2027_SEM_REGRA`.
 */
export function simplesDas(rate: SimplesNacionalRate, reductions: SimplesReductions, asOf: string): SimplesDas {
  const removed: SimplesTaxKey[] = [];
  if (reductions.icmsAlreadyPaid) removed.push('icms');
  if (reductions.issWithheld) removed.push('iss');
  if (reductions.pisCofinsMonophasic) {
    if (asOf >= '2027-01-01') return { status: 'MONOFASICO_2027_SEM_REGRA', dasPct: null, removed: [] };
    removed.push('pis', 'cofins');
  }
  const scaled = (s: string) => BigInt(s.replace('.', ''));
  let das = scaled(rate.dasPct);
  for (const k of removed) {
    // Se ICMS/ISS já saíram do DAS pelo sublimite, não se tira duas vezes.
    if (rate.stateTaxesOutsideDas && (k === 'icms' || k === 'iss')) continue;
    das -= scaled(rate.components[k]);
  }
  return { status: 'OK', dasPct: fmt4(das), removed };
}
