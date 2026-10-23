import { issRate as issRecife, issRateCheck, legacyTaxes, presumidoByActivity, presumidoCommerce, SIMPLES_CEILING_CENTS, SIMPLES_GENERAL_SUBLIMIT_CENTS, simplesAnnexPeriod, simplesNacional, transitionFor, parseCents } from '@fixer/tax-rules';
import type { Regime } from './sale-tax.js';

// Visão do que o motor tributário (packages/tax-rules) calcula para esta oficina hoje: a mesma conta que o preço usa, mas
// mostrada por inteiro para a tela de configuração "Tributário". Não decide nada novo: só chama o pacote com os dados do perfil.

export interface SimplesOverview {
  rbt12: string;
  bracket: number;
  nominalPct: string;
  effectivePct: string;
  /** Percentual da receita pago no DAS (a efetiva menos o que sai do DAS acima do sublimite). */
  dasPct: string;
  /** Cada tributo em % da receita; só os que têm valor. */
  components: { key: string; pct: string }[];
  /** Quanto do teto de R$ 4,8 milhões e do sublimite de R$ 3,6 milhões a RBT12 já usou, em %. */
  ceilingUsedPct: number;
  sublimitUsedPct: number;
  stateTaxesOutsideDas: boolean;
  /** RBT12 acima do teto: o Anexo I não se aplica. */
  outsideSimples: boolean;
  /** Receita em que a faixa muda; null na última. */
  nextBracketAtCents: string | null;
}

export interface PresumidoOverview {
  irpjPct: string;
  csllPct: string;
  pisPct: string;
  cofinsPct: string;
  totalPct: string;
  pisCofinsExtinct: boolean;
}

export interface TransitionOverview {
  from: string;
  to: string;
  pisCofinsInForce: boolean;
  icmsRemainingPct: string;
  issRemainingPct: string;
  simplesOptantesCharged: boolean;
}

export interface IssOverview {
  /** Alíquota salva na configuração (prefeitura ou digitada), em %. */
  saved: string | null;
  /** Subitem da LC 116 da oficina. */
  item: string | null;
  /** Resposta da tabela municipal do motor; null quando faltam município ou subitem. */
  engine: { status: string; ratePct: string | null; effectivePct: string | null; remainingPct: string | null } | null;
  /** A alíquota salva respeita os limites da LC 116 (2% a 5%)? */
  check: string | null;
}

/** Imposto sobre a mão de obra (serviço), separado das peças: Anexo III no Simples; no Presumido, a presunção de serviços. */
export interface ServicesOverview {
  simples: { annex: 'III'; bracket: number; nominalPct: string; effectivePct: string; dasPct: string; components: { key: string; pct: string }[]; issCapApplied: boolean; stateTaxesOutsideDas: boolean } | null;
  presumido: PresumidoOverview | null;
}

export interface TaxOverview {
  asOf: string;
  regime: Regime | null;
  simples: SimplesOverview | null;
  presumido: PresumidoOverview | null;
  transition: TransitionOverview | null;
  iss: IssOverview;
  services: ServicesOverview;
  /** Fidelidade do motor contra a última declaração da Receita (PGDAS-D); null sem leitura. */
  conferencia: unknown | null;
}

const KEY_ORDER = ['icms', 'iss', 'pis', 'cofins', 'cbs', 'ibs', 'ipi', 'irpj', 'csll', 'cpp'];

export function buildTaxOverview(input: { regime: Regime | null; rbt12: string | null; asOf: string; conferencia?: unknown; iss?: { ibge: string | null; item: string | null; saved: string | null } }): TaxOverview {
  const { regime, asOf } = input;
  // Sem regime informado o resto do sistema assume Simples (nfe-import §8.3).
  const effectiveRegime = regime ?? 'SIMPLES';
  const t = transitionFor(asOf);
  const legacy = legacyTaxes(asOf);

  let simples: SimplesOverview | null = null;
  if (effectiveRegime === 'SIMPLES' && input.rbt12 !== null) {
    const cents = parseCents(input.rbt12);
    if (cents !== null && cents > 0n) {
      const r = simplesNacional('I', input.rbt12, asOf);
      if (r) {
        const nextBracketAtCents = nextBracketLimit(cents, asOf);
        simples = {
          rbt12: input.rbt12,
          bracket: Number(r.bracket),
          nominalPct: r.nominalPct,
          effectivePct: r.effectivePct,
          dasPct: r.dasPct,
          components: componentsOf(r.components),
          ceilingUsedPct: pctOf(cents, SIMPLES_CEILING_CENTS),
          sublimitUsedPct: pctOf(cents, SIMPLES_GENERAL_SUBLIMIT_CENTS),
          stateTaxesOutsideDas: r.stateTaxesOutsideDas,
          outsideSimples: false,
          nextBracketAtCents,
        };
      } else if (cents > SIMPLES_CEILING_CENTS) {
        simples = { rbt12: input.rbt12, bracket: 0, nominalPct: '0', effectivePct: '0', dasPct: '0', components: [], ceilingUsedPct: pctOf(cents, SIMPLES_CEILING_CENTS), sublimitUsedPct: 100, stateTaxesOutsideDas: true, outsideSimples: true, nextBracketAtCents: null };
      }
    }
  }

  const issIn = input.iss ?? { ibge: null, item: null, saved: null };
  const eng = issIn.ibge && issIn.item ? issRecife(issIn.ibge, issIn.item, asOf) : null;
  const iss: IssOverview = {
    saved: issIn.saved,
    item: issIn.item,
    engine: eng && { status: eng.status, ratePct: eng.ratePct, effectivePct: eng.effectivePct, remainingPct: eng.transitionRemainingPct },
    check: issIn.saved && issIn.item ? issRateCheck(issIn.saved, issIn.item, asOf) : null,
  };

  let servicesSimples: ServicesOverview['simples'] = null;
  if (effectiveRegime === 'SIMPLES' && input.rbt12 !== null) {
    const r3 = simplesNacional('III', input.rbt12, asOf);
    if (r3) servicesSimples = { annex: 'III', bracket: Number(r3.bracket), nominalPct: r3.nominalPct, effectivePct: r3.effectivePct, dasPct: r3.dasPct, components: componentsOf(r3.components), issCapApplied: r3.issCapApplied, stateTaxesOutsideDas: r3.stateTaxesOutsideDas };
  }
  const ps = effectiveRegime === 'PRESUMIDO' ? presumidoByActivity('SERVICOS', asOf) : null;
  const pc = effectiveRegime === 'PRESUMIDO' ? presumidoCommerce(asOf) : null;
  return {
    asOf,
    regime,
    simples,
    presumido: pc && { irpjPct: pc.irpjPct, csllPct: pc.csllPct, pisPct: pc.pisPct, cofinsPct: pc.cofinsPct, totalPct: pc.totalPct, pisCofinsExtinct: pc.pisCofinsExtinct },
    transition: t && legacy ? { from: t.from, to: t.to, pisCofinsInForce: t.pisCofinsInForce, icmsRemainingPct: legacy.icmsRemainingPct, issRemainingPct: legacy.issRemainingPct, simplesOptantesCharged: t.simplesOptantesCharged } : null,
    iss,
    services: { simples: servicesSimples, presumido: ps && { irpjPct: ps.irpjPct, csllPct: ps.csllPct, pisPct: ps.pisPct, cofinsPct: ps.cofinsPct, totalPct: ps.totalPct, pisCofinsExtinct: ps.pisCofinsExtinct } },
    conferencia: input.conferencia ?? null,
  };
}

const componentsOf = (c: Record<string, string>) => KEY_ORDER.filter((k) => Number(c[k] ?? 0) > 0).map((k) => ({ key: k, pct: c[k]! }));

const pctOf = (cents: bigint, limit: bigint) => Math.min(100, Math.round(Number((cents * 10_000n) / limit)) / 100);

/** Receita em que a faixa atual acaba (centavos, como texto), lida da tabela do Anexo I; null na última faixa. */
function nextBracketLimit(cents: bigint, asOf: string): string | null {
  const brackets = simplesAnnexPeriod('I', asOf)?.brackets ?? [];
  const current = brackets.find((b) => cents <= b.upToCents);
  return current && current.upToCents < SIMPLES_CEILING_CENTS && current !== brackets[brackets.length - 1] ? current.upToCents.toString() : null;
}
