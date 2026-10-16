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
