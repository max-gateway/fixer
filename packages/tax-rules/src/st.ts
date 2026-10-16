import { ST_AUTOPECAS_ANEXO_II, type StAutopecaItem } from '../data/st-autopecas-anexo-ii.js';
import { ST_AUTOPECAS_PROTOCOLO } from '../data/st-autopecas-protocolo.js';

const digits = (s: string) => s.replace(/\D/g, '');

/** Itens do Anexo II (autopeças) do Convênio ICMS 142/2018 em que o NCM se enquadra (o convênio lista posições e subposições: vale o prefixo); vazio se não consta. */
export function stAutopecaItems(ncm: string | null | undefined): StAutopecaItem[] {
  const d = digits(ncm ?? '');
  if (d.length < 4) return [];
  return ST_AUTOPECAS_ANEXO_II.filter((it) => it.ncm.some((c) => d.startsWith(digits(c))));
}

/** O CEST consta do Anexo II de autopeças? */
export function stAutopecaCest(cest: string | null | undefined): StAutopecaItem | null {
  const c = digits(cest ?? '');
  if (c.length !== 7) return null;
  return ST_AUTOPECAS_ANEXO_II.find((it) => digits(it.cest) === c) ?? null;
}

export type StProtocolStatus =
  /** A UF de destino está no protocolo na data e o CEST não está nas exceções. */
  | 'ABRANGIDO'
  | 'CEST_EXCETUADO'
  | 'UF_FORA_DO_PROTOCOLO'
  /** O CEST nem consta do Anexo II. */
  | 'FORA_DO_ANEXO_II'
  /** Antes de 2023-02-01 o protocolo tinha outra lista e esta tabela não cobre. */
  | 'SEM_DADO_NA_DATA';

/**
 * O Protocolo ICMS 41/2008 atribui ao remetente a retenção do ICMS-ST de um item de autopeça com este CEST para esta UF de
 * destino, na data `asOf`? Não diz nada sobre a UF de origem nem sobre as exceções por natureza da operação.
 */
export function stProtocolo(cest: string, destUf: string, asOf: string): StProtocolStatus {
  if (!stAutopecaCest(cest)) return 'FORA_DO_ANEXO_II';
  const p = ST_AUTOPECAS_PROTOCOLO.find((x) => asOf >= x.from && (x.to === null || asOf <= x.to));
  if (!p) return 'SEM_DADO_NA_DATA';
  if (p.excludedCest.some((e) => digits(e) === digits(cest))) return 'CEST_EXCETUADO';
  return p.destinations.includes(destUf.toUpperCase()) ? 'ABRANGIDO' : 'UF_FORA_DO_PROTOCOLO';
}
