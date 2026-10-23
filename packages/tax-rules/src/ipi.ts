import { TIPI_LAST_UPDATE, TIPI_TABLE } from '../data/tipi.js';

// IPI pela TIPI (Decreto 11.158/2022): alíquota por NCM de 8 dígitos e por ex-tarifário, na versão atualizada pela Receita.
// Esta consulta responde "qual é a alíquota deste produto na TIPI". Se o IPI incide na operação (emitente industrial ou
// equiparado), se há suspensão, isenção ou imunidade, é decisão do enquadramento, não da tabela.

export type IpiKind = 'TRIBUTADO' | 'ALIQUOTA_ZERO' | 'NAO_TRIBUTADO';

export type IpiStatus =
  | 'OK'
  | 'NCM_INVALIDO' // não tem 8 dígitos
  | 'NCM_INEXISTENTE' // não consta da TIPI
  | 'NCM_SEM_ALIQUOTA' // linha-pai: a alíquota está nos desdobramentos
  | 'EX_NAO_ENCONTRADO'
  | 'DATA_ANTERIOR_A_TABELA';

export interface IpiExAlternative {
  ex: string;
  kind: IpiKind;
  /** % do IPI; null quando não tributado. */
  ratePct: string | null;
}

export interface IpiResult {
  status: IpiStatus;
  ncm: string;
  ex: string | null;
  kind: IpiKind | null;
  /** Alíquota em %, 2 casas; "0.00" na alíquota zero; null quando não tributado ou sem resposta. */
  ratePct: string | null;
  /** CST do IPI na saída que a tabela sozinha determina (50 tributada, 51 alíquota zero, 53 não tributada). */
  cstSaida: '50' | '51' | '53' | null;
  /** Outras alíquotas da mesma NCM por ex-tarifário: se o produto for um deles, a alíquota muda. */
  exAlternatives: IpiExAlternative[];
}

interface Row {
  rate: string | null;
}

interface Index {
  base: Map<string, Row>;
  ex: Map<string, Map<string, Row>>;
}

let cached: Index | null = null;
function index(): Index {
  if (cached) return cached;
  const base = new Map<string, Row>();
  const ex = new Map<string, Map<string, Row>>();
  for (const line of TIPI_TABLE.split('\n')) {
    const [ncm, e, rate] = line.split('|');
    if (!ncm) continue;
    const row = { rate: rate ? rate : null };
    if (!e) base.set(ncm, row);
    else {
      if (!ex.has(ncm)) ex.set(ncm, new Map());
      ex.get(ncm)!.set(e, row);
    }
  }
  return (cached = { base, ex });
}

const two = (r: string) => (r.includes('.') ? r.padEnd(r.indexOf('.') + 3, '0') : `${r}.00`);

function describe(rate: string | null): { kind: IpiKind; ratePct: string | null } | null {
  if (rate === null) return null;
  if (rate === 'NT') return { kind: 'NAO_TRIBUTADO', ratePct: null };
  return Number(rate) === 0 ? { kind: 'ALIQUOTA_ZERO', ratePct: '0.00' } : { kind: 'TRIBUTADO', ratePct: two(rate) };
}

const CST: Record<IpiKind, '50' | '51' | '53'> = { TRIBUTADO: '50', ALIQUOTA_ZERO: '51', NAO_TRIBUTADO: '53' };

/** Data da última atualização da TIPI no pacote: antes dela a consulta não responde. */
export const TIPI_EFFECTIVE_FROM = TIPI_LAST_UPDATE.date;

/** Alíquota de IPI da NCM (com ou sem pontos) e do ex-tarifário, se houver, na data `asOf` (AAAA-MM-DD). */
export function ipiRate(ncmInput: string, asOf: string, exInput: string | null = null): IpiResult {
  const ex = exInput === null ? null : exInput.replace(/^\s*ex\.?\s*/i, '').trim().replace(/^0+(?=\d)/, '') || null;
  const ncm = ncmInput.replace(/\D/g, '');
  const fail = (status: IpiStatus): IpiResult => ({ status, ncm, ex, kind: null, ratePct: null, cstSaida: null, exAlternatives: [] });
  if (!/^\d{8}$/.test(ncm)) return fail('NCM_INVALIDO');
  if (asOf < TIPI_EFFECTIVE_FROM) return fail('DATA_ANTERIOR_A_TABELA');
  const idx = index();
  const baseRow = idx.base.get(ncm);
  const exRows = idx.ex.get(ncm);
  if (!baseRow && !exRows) return fail('NCM_INEXISTENTE');

  const alternatives: IpiExAlternative[] = [...(exRows ?? [])].flatMap(([e, row]) => {
    const d = describe(row.rate);
    return d ? [{ ex: e, kind: d.kind, ratePct: d.ratePct }] : [];
  });

  if (ex !== null) {
    const row = exRows?.get(ex);
    const d = row && describe(row.rate);
    if (!d) return fail('EX_NAO_ENCONTRADO');
    return { status: 'OK', ncm, ex, kind: d.kind, ratePct: d.ratePct, cstSaida: CST[d.kind], exAlternatives: alternatives.filter((a) => a.ex !== ex) };
  }
  const d = baseRow && describe(baseRow.rate);
  if (!d) return fail('NCM_SEM_ALIQUOTA');
  return { status: 'OK', ncm, ex: null, kind: d.kind, ratePct: d.ratePct, cstSaida: CST[d.kind], exAlternatives: alternatives };
}

/** Quantas linhas (NCM e ex-tarifários) a tabela tem; para métricas e testes. */
export const tipiSize = () => TIPI_TABLE.split('\n').length;
