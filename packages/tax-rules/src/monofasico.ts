import { MONOFASICO_AUTOPECAS, MONOFASICO_AUTOPECAS_META, type MonofasicoEntry } from '../data/monofasico-autopecas.js';
import { inForce } from './types.js';

export type MonofasicoStatus =
  /** O NCM está na lista: PIS/Cofins a 0% para o revendedor. */
  | 'SIM'
  /** O NCM está na lista com condição (ex-tarifário ou destino): a pessoa precisa confirmar. */
  | 'DEPENDE'
  /** O NCM não está na lista. */
  | 'NAO'
  /** A data está fora da vigência da lista (a Lei 10.485 é revogada em 01/01/2027). */
  | 'FORA_DE_VIGENCIA'
  /** NCM ausente ou curto demais para decidir (menos de 4 dígitos). */
  | 'NCM_INVALIDO';

export interface MonofasicoResult {
  status: MonofasicoStatus;
  entry: MonofasicoEntry | null;
}

/**
 * O NCM é autopeça monofásica (Lei 10.485/2002) na data `asOf` (AAAA-MM-DD)? Vale a entrada mais específica: o
 * Anexo II lista a posição inteira "84.31" com condição, mas o Anexo I tira 8431.41.00 e 8431.42.00 dela.
 */
export function monofasicoAutopeca(ncm: string | null | undefined, asOf: string): MonofasicoResult {
  const digits = (ncm ?? '').replace(/\D/g, '');
  if (digits.length < 4) return { status: 'NCM_INVALIDO', entry: null };
  if (!inForce(MONOFASICO_AUTOPECAS_META, asOf)) return { status: 'FORA_DE_VIGENCIA', entry: null };

  let best: MonofasicoEntry | null = null;
  for (const e of MONOFASICO_AUTOPECAS) {
    if (digits.startsWith(e.prefix) && (!best || e.prefix.length > best.prefix.length)) best = e;
  }
  if (!best) return { status: 'NAO', entry: null };
  return { status: best.kind === 'FULL' ? 'SIM' : 'DEPENDE', entry: best };
}
