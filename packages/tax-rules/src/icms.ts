import { UF_REGION } from '../data/icms-interestadual.js';

export type InterstateRateKind = 'GERAL_12' | 'SUL_SUDESTE_7' | 'IMPORTADO_4';

export interface InterstateRate {
  pct: '12' | '7' | '4';
  kind: InterstateRateKind;
}

/**
 * Alíquota interestadual do ICMS (Resoluções do Senado 22/1989 e 13/2012). `importedOrOver40` indica bem importado ou
 * com Conteúdo de Importação superior a 40% (CST de origem 1, 2, 3 ou 8), que paga 4% desde 2013, salvo as exceções da
 * resolução (origens 6, 7 e 4, que o chamador deve tratar como NÃO importado). Mesma UF devolve null: operação interna.
 */
export function interstateRate(origin: string, dest: string, importedOrOver40 = false): InterstateRate | null {
  const o = origin.toUpperCase();
  const d = dest.toUpperCase();
  if (o === d) return null;
  if (!(o in UF_REGION) || !(d in UF_REGION)) return null;
  if (importedOrOver40) return { pct: '4', kind: 'IMPORTADO_4' };
  const south = UF_REGION[o] === 'S' || UF_REGION[o] === 'SE';
  const target = UF_REGION[d] === 'N' || UF_REGION[d] === 'NE' || UF_REGION[d] === 'CO' || d === 'ES';
  return south && target ? { pct: '7', kind: 'SUL_SUDESTE_7' } : { pct: '12', kind: 'GERAL_12' };
}

/** CST de origem (1º dígito) que a Resolução 13/2012 manda tributar a 4%: 1, 2, 3 e 8. As origens 6 e 7 (sem similar) e 4 (PPB) ficam fora. */
export const ORIGIN_TAXED_AT_4 = new Set(['1', '2', '3', '8']);
