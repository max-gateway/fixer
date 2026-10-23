import { IBS_CBS_REDUCTIONS, type ReductionItem } from '../data/ibs-cbs-reducoes.js';
import { IBS_CBS_REDUCED_AUTOPECAS, IBS_CBS_REFERENCE, type ReducedRateItem, type ReferenceRate } from '../data/ibs-cbs-referencia.js';

/** Alíquotas de referência do ano; existe de 2027 a 2033, com `status` PENDENTE até o Senado fixar por resolução. */
export function referenceRate(year: number): ReferenceRate | null {
  return IBS_CBS_REFERENCE.find((r) => r.year === year) ?? null;
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Itens da LC 214 com redução de alíquota que alcançam o NCM (só os que cruzam com autopeças); vazio = alíquota padrão. */
export function reducedRateForNcm(ncm: string | null | undefined): ReducedRateItem[] {
  const d = digits(ncm ?? '');
  if (d.length < 4) return [];
  return IBS_CBS_REDUCED_AUTOPECAS.filter((it) => it.ncm.some((c) => d.startsWith(digits(c))));
}

export interface ReductionCandidate extends ReductionItem {
  /** O código do item é exatamente o da consulta (e não só um prefixo dele): candidato mais forte. */
  exact: boolean;
}

/**
 * Itens dos Anexos I a XV da LC 214 cujo código de NCM (ou de NBS, para serviço) cobre o da consulta. São CANDIDATOS à redução de 60%
 * ou a zero, nunca a decisão: a lei exige, na maioria dos itens, requisitos da legislação específica e traz ressalvas que o código não
 * prova (ver caveats de ibs-cbs-reducoes). Vazio = o código não consta de nenhum anexo e segue a alíquota padrão.
 */
export function reducedRateCandidates(codes: { ncm?: string | null; nbs?: string | null }): ReductionCandidate[] {
  const ncm = digits(codes.ncm ?? '');
  const nbs = digits(codes.nbs ?? '');
  const out: ReductionCandidate[] = [];
  for (const it of IBS_CBS_REDUCTIONS) {
    const byNcm = ncm.length >= 4 ? it.ncm.filter((p) => ncm.startsWith(p)) : [];
    const byNbs = nbs.length >= 5 ? it.nbs.filter((p) => nbs.startsWith(p)) : [];
    if (byNcm.length || byNbs.length) out.push({ ...it, exact: [...byNcm, ...byNbs].some((p) => p === ncm || p === nbs) });
  }
  return out;
}
