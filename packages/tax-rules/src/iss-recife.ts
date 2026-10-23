import { ISS_RECIFE_DEFAULT_PCT, ISS_RECIFE_META, ISS_RECIFE_RULES, RECIFE_IBGE } from '../data/iss-recife.js';
import { lc116Item } from './iss.js';
import { legacyTaxes } from './transition.js';
import { inForce } from './types.js';

export type IssRecifeStatus = 'OK' | 'SEM_REGRA' | 'SUBITEM_INEXISTENTE' | 'SUBITEM_REVOGADO' | 'FORA_DE_VIGENCIA' | 'MUNICIPIO_NAO_COBERTO';

export interface IssRecifeResult {
  status: IssRecifeStatus;
  /** Alíquota do CTM, em %, 2 casas. */
  ratePct: string | null;
  /** Alíquota efetiva depois da redução de 2029 a 2032 (LC 116, art. 8º-B), 4 casas; igual à nominal antes disso. */
  effectivePct: string | null;
  /** Quanto da alíquota de 31/12/2028 ainda vale na data, em %. */
  transitionRemainingPct: string | null;
}

const none = (status: IssRecifeStatus): IssRecifeResult => ({ status, ratePct: null, effectivePct: null, transitionRemainingPct: null });

/** Alíquota de ISS de um município por subitem da LC 116. Hoje só o Recife; qualquer outro código IBGE é MUNICIPIO_NAO_COBERTO. */
export function issRate(ibge: string, code: string, asOf: string): IssRecifeResult {
  if (ibge.replace(/\D/g, '').slice(0, 7) !== RECIFE_IBGE) return none('MUNICIPIO_NAO_COBERTO');
  const item = lc116Item(code);
  if (!item) return none('SUBITEM_INEXISTENTE');
  if (item.revoked) return none('SUBITEM_REVOGADO');
  if (!inForce(ISS_RECIFE_META, asOf)) return none('FORA_DE_VIGENCIA');
  const special = ISS_RECIFE_RULES.find((r) => r.groups.includes(item.group));
  if (special && special.ratePct === null) return none('SEM_REGRA');
  const ratePct = special?.ratePct ?? ISS_RECIFE_DEFAULT_PCT;
  const remaining = legacyTaxes(asOf)?.issRemainingPct ?? '100';
  const scaled = BigInt(ratePct.replace('.', '')) * BigInt(remaining) * 100n; // % × 10^4
  const fourDecimals = (v: bigint) => `${v / 10_000n}.${(v % 10_000n).toString().padStart(4, '0')}`;
  return { status: 'OK', ratePct, effectivePct: fourDecimals(scaled / 100n), transitionRemainingPct: remaining };
}
