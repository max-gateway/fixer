import { readFirstSheet } from './xlsx.js';

// Extrai a TIPI (Decreto 11.158/2022, texto atualizado pela Receita Federal) da planilha oficial: NCM de 8 dígitos, ex-tarifário e
// alíquota. O mesmo parser gera `data/tipi.ts` (scripts/gen-tipi.mjs) e confere o dado contra a planilha (verify:sources).

export interface TipiEntry {
  /** NCM com 8 dígitos, sem pontos. */
  ncm: string;
  /** Ex-tarifário ("1", "2"...) ou null para a linha da NCM. */
  ex: string | null;
  /** Alíquota em %, 2 a 4 casas ("3.25"), "NT" (não tributado) ou null (linha-pai sem alíquota própria). */
  rate: string | null;
}

export interface TipiParse {
  entries: TipiEntry[];
  /** Último ato da lista "Atualizações" da planilha, com a data (AAAA-MM-DD). */
  lastUpdate: { act: string; date: string };
}

const MONTHS: Record<string, string> = { janeiro: '01', fevereiro: '02', 'março': '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };

function parseDate(act: string): string {
  const m = /de (\d{1,2})(?:º)? de ([a-zç]+) de (\d{4})/i.exec(act);
  const month = m && MONTHS[m[2]!.toLowerCase()];
  if (!m || !month) throw new Error(`não consegui ler a data do ato: "${act}"`);
  return `${m[3]}-${month}-${m[1]!.padStart(2, '0')}`;
}

/** "7.8000000000000007" -> "7.8"; "18.809999999999999" -> "18.81"; "13" -> "13". */
function normalizeRate(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`alíquota inválida: "${v}"`);
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/** "Ex 01" e "1" são o mesmo ex-tarifário: guarda só os dígitos, sem zeros à esquerda. */
export function normalizeEx(raw: string): string | null {
  const digits = raw.replace(/^\s*ex\.?\s*/i, '').trim().replace(/^0+(?=\d)/, '');
  return digits === '' ? null : digits;
}

export function parseTipi(xlsx: Buffer): TipiParse {
  const rows = readFirstSheet(xlsx);
  const updates = rows.find((r) => /^Atualiza/.test((r.cells.A ?? '').trim()));
  const acts = (updates?.cells.A ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^Atualiza/.test(l));
  if (!acts.length) throw new Error('lista "Atualizações" não encontrada na planilha');
  const last = acts[acts.length - 1]!;

  const entries: TipiEntry[] = [];
  let current: string | null = null;
  for (const { cells } of rows) {
    const a = (cells.A ?? '').trim();
    const ex = normalizeEx(cells.B ?? '');
    const d = (cells.D ?? '').trim();
    if (/^\d{4}\.\d{2}\.\d{2}$/.test(a)) current = a.replace(/\./g, '');
    else if (a && !/^NCM$/i.test(a)) {
      current = null; // capítulo, posição ou subposição: o ex-tarifário que vier depois não é dela
      continue;
    }
    if (!current) continue;
    if (ex === null && !/^\d{4}\.\d{2}\.\d{2}$/.test(a)) continue; // linha sem NCM nem ex
    entries.push({ ncm: current, ex, rate: d === '' ? null : d.toUpperCase() === 'NT' ? 'NT' : normalizeRate(d) });
  }
  if (entries.length < 10_000) throw new Error(`TIPI com ${entries.length} linhas: esperava mais de 10.000`);
  return { entries, lastUpdate: { act: last, date: parseDate(last) } };
}

/** Texto do arquivo `data/tipi.ts` (uma linha por NCM/ex: `NCM|EX|ALIQUOTA`). */
export function renderTipiTable(entries: TipiEntry[]): string {
  return entries.map((e) => `${e.ncm}|${e.ex ?? ''}|${e.rate ?? ''}`).join('\n');
}
