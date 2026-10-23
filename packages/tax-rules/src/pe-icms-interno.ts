import { PE_ICMS_ANNEX_OVERLAPS_REVIEWED, PE_ICMS_INTERNAL_MODAL } from '../data/pe-icms-interno.js';
import { PE_ST_PNEUS } from '../data/pe-icms.js';
import { stAutopecaItems } from './st.js';

// ICMS interno de PE por NCM (Lei 15.730/2016, art. 15, VII): só para os segmentos curados (autopeças e pneus).

export type PeInternalStatus =
  | 'OK'
  | 'DEPENDE' // a NCM também consta de anexo de alíquota majorada/FECEP e a descrição do produto decide
  | 'FORA_DA_COBERTURA' // NCM de segmento que o pacote não cura
  | 'DATA_SEM_TABELA'
  | 'NCM_INVALIDO';

export interface PeInternalResult {
  status: PeInternalStatus;
  /** Alíquota interna em %, 2 casas; null quando não há resposta. */
  ratePct: string | null;
  /** Alíquota sem FECEP: autopeça e pneu não pagam o adicional (o FECEP está embutido nas alíquotas do Anexo 1). */
  fecepPct: '0.00' | null;
  note: string | null;
}

const fail = (status: PeInternalStatus, note: string | null = null): PeInternalResult => ({ status, ratePct: null, fecepPct: null, note });

const isPneu = (ncm: string) => PE_ST_PNEUS.some((p) => p.ncm.some((n) => ncm.startsWith(n.replace(/\D/g, ''))));
const isAutopeca = (ncm: string) => stAutopecaItems(ncm).length > 0;

/** Alíquota interna de ICMS em PE para autopeças e pneus (NCM de 8 dígitos) na data. */
export function peInternalRate(ncmInput: string, asOf: string): PeInternalResult {
  const ncm = ncmInput.replace(/\D/g, '');
  if (!/^\d{8}$/.test(ncm)) return fail('NCM_INVALIDO');
  if (!isAutopeca(ncm) && !isPneu(ncm)) return fail('FORA_DA_COBERTURA', 'segmento sem tabela: o art. 15 da Lei 15.730 tem alíquotas de 7% a 29% por produto');
  const period = PE_ICMS_INTERNAL_MODAL.find((p) => asOf >= p.from && (p.to === null || asOf <= p.to));
  if (!period) return fail('DATA_SEM_TABELA', 'a tabela começa em 2019-04-01');
  const overlap = PE_ICMS_ANNEX_OVERLAPS_REVIEWED[ncm];
  if (overlap) return { status: 'DEPENDE', ratePct: period.ratePct, fecepPct: null, note: overlap };
  return { status: 'OK', ratePct: period.ratePct, fecepPct: '0.00', note: null };
}
