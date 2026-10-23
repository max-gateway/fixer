import type { AnnexBracket, AnnexIssCap, AnnexPeriod, SimplesAnnexId, SimplesTaxKey } from '../../data/simples-anexos.js';
import { flat, htmlToText } from './html.js';

// Extrai os Anexos II a V do Simples Nacional do texto oficial: LC 123/2006 (redação da LC 155/2016, 2018 a 2026) e LC 214/2025,
// Anexos XIX a XXII (2027 em diante, com a redação da LC 227/2026). O mesmo parser gera `data/simples-anexos.ts`
// (scripts/gen-simples-anexos.mjs) e confere o dado contra a lei (verify:sources), então os dois nunca divergem em silêncio.

const TAX_BY_HEADER: Record<string, SimplesTaxKey> = { IRPJ: 'irpj', CSLL: 'csll', COFINS: 'cofins', 'PIS/PASEP': 'pis', CBS: 'cbs', CPP: 'cpp', IPI: 'ipi', ICMS: 'icms', ISS: 'iss', IBS: 'ibs' };
const ZERO = '0.00';
const emptyShare = (): Record<SimplesTaxKey, string> => ({ irpj: ZERO, csll: ZERO, cofins: ZERO, pis: ZERO, cbs: ZERO, cpp: ZERO, ipi: ZERO, icms: ZERO, iss: ZERO, ibs: ZERO });

const pct = (s: string) => s.replace(',', '.').replace(/^(\d+)$/, '$1.00').replace(/^(\d+\.\d)$/, '$10');
const cents = (s: string) => BigInt(s.replace(/\./g, '').replace(',', ''));
const hundredths = (p: string) => BigInt(p.replace('.', ''));

const LC123 = 'LC 123/2006, Anexo {A} (redação da LC 155/2016)';
const LC214 = 'LC 214/2025, Anexo {X} (Anexo {A} da LC 123), com a redação da LC 227/2026';

const ROMAN: Record<SimplesAnnexId, string> = { II: 'II', III: 'III', IV: 'IV', V: 'V' };
const LC214_ANNEX: Record<SimplesAnnexId, string> = { II: 'XIX', III: 'XX', IV: 'XXI', V: 'XXII' };
const NEXT_LC214: Record<SimplesAnnexId, string> = { II: 'ANEXO XX', III: 'ANEXO XXI', IV: 'ANEXO XXII', V: 'ANEXO XXIII' };
const NEXT_LC123: Record<SimplesAnnexId, string> = { II: 'ANEXO III DA LEI COMPLEMENTAR', III: 'ANEXO IV DA LEI COMPLEMENTAR', IV: 'ANEXO V DA LEI COMPLEMENTAR', V: 'ANEXO VI' };

const FAIXA = String.raw`([1-6])[ªaº] Faixa`;
const NOMINAL_ROW = new RegExp(String.raw`${FAIXA} (?:Até|De) ([\d.]+,\d{2})(?: a ([\d.]+,\d{2}))? (\d+,\d{2})% (?:([\d.]+,\d{2})|[-–])(?= |$)`, 'g');
const SHARE_ROW = new RegExp(String.raw`${FAIXA}((?: \d+,\d{2}%(?: \(\*\))?)+)(?= |$)`, 'g');

interface Nominal {
  bracket: number;
  upToCents: bigint;
  nominalPct: string;
  deductionCents: bigint;
}

function parseNominal(text: string): Nominal[] {
  const rows: Nominal[] = [];
  for (const m of text.matchAll(NOMINAL_ROW)) {
    rows.push({ bracket: Number(m[1]), upToCents: cents(m[3] ?? m[2]!), nominalPct: pct(m[4]!), deductionCents: m[5] ? cents(m[5]) : 0n });
  }
  return rows;
}

interface ShareTable {
  shares: Record<SimplesTaxKey, string>[];
  cap: AnnexIssCap | null;
}

/** Última tabela de repartição do trecho (a redação mais recente aparece depois da antiga). */
function parseLastShare(text: string, where: string): ShareTable {
  const starts = [...text.matchAll(/Percentual de Reparti[çc][ãa]o/g)].map((m) => m.index!);
  if (!starts.length) throw new Error(`${where}: sem tabela de repartição`);
  const seg = text.slice(starts[starts.length - 1]);

  const head = /^Percentual de Reparti[çc][ãa]o(?: dos Tributos)? (.*?) 1[ªaº] Faixa/.exec(seg);
  if (!head) throw new Error(`${where}: cabeçalho da repartição não encontrado`);
  const cols = head[1]!
    .replace(/\(\*\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const key = TAX_BY_HEADER[t.toUpperCase()];
      if (!key) throw new Error(`${where}: coluna desconhecida "${t}"`);
      return key;
    });

  const shares: Record<SimplesTaxKey, string>[] = [];
  let lastRowEnd = 0;
  for (const m of seg.matchAll(SHARE_ROW)) {
    const vals = [...m[2]!.matchAll(/(\d+,\d{2})%/g)].map((v) => pct(v[1]!));
    if (vals.length > cols.length) throw new Error(`${where}: faixa ${m[1]} com mais valores que colunas`);
    const row = emptyShare();
    vals.forEach((v, i) => (row[cols[i]!] = v));
    const idx = Number(m[1]) - 1;
    if (shares[idx]) continue; // só a primeira ocorrência de cada faixa
    shares[idx] = row;
    lastRowEnd = Math.max(lastRowEnd, m.index! + m[0].length);
  }
  if (shares.length !== 6 || shares.some((s) => !s)) throw new Error(`${where}: esperava 6 faixas, achei ${shares.filter(Boolean).length}`);
  shares.forEach((s, i) => {
    const total = Object.values(s).reduce((a, v) => a + hundredths(v), 0n);
    if (total !== 10_000n) throw new Error(`${where}: faixa ${i + 1} soma ${Number(total) / 100}%, não 100%`);
  });

  // Teto do ISS (LC 123, art. 18, § 1º-B, I): na 5ª faixa, acima de certa alíquota efetiva o ISS fica fixo e o excedente
  // (alíquota efetiva − teto) é redistribuído pelos demais tributos.
  const redis = /5[ªaº] Faixa, com ?al[ií]quota efetiva superior a [\d,]+%(.*?)(?=\(Vig[êe]ncia|Para o ano|\(Reda[çc][ãa]o|Al[ií]quotas do Simples|ANEXO|$)/.exec(seg.slice(lastRowEnd));
  let cap: AnnexIssCap | null = null;
  if (redis) {
    const entries = [...redis[1]!.matchAll(/x (\d+(?:,\d+)?)%|Percentual de ISS fixo em (\d+(?:,\d+)?)%/g)];
    if (entries.length !== cols.length) throw new Error(`${where}: redistribuição do ISS com ${entries.length} entradas para ${cols.length} colunas`);
    const share = emptyShare();
    let issPct: string | null = null;
    entries.forEach((e, i) => {
      if (e[1]) share[cols[i]!] = pct(e[1]);
      else {
        if (cols[i] !== 'iss') throw new Error(`${where}: "ISS fixo" fora da coluna ISS`);
        issPct = pct(e[2]!);
      }
    });
    if (issPct === null) throw new Error(`${where}: redistribuição sem ISS fixo`);
    const total = Object.values(share).reduce((a, v) => a + hundredths(v), 0n);
    // A lei arredonda a redistribuição a 2 casas (ex.: 99,99%); a diferença vai ao tributo de maior repartição (art. 18, § 1º-B, II).
    if (total < 9_995n || total > 10_005n) throw new Error(`${where}: redistribuição soma ${Number(total) / 100}%, longe de 100%`);
    cap = { issPct, bracket: 5, share };
  }
  return { shares, cap };
}

function build(id: string, annex: SimplesAnnexId, from: string, to: string | null, source: string, nominal: Nominal[], t: ShareTable): AnnexPeriod {
  if (nominal.length !== 6) throw new Error(`${id}: esperava 6 faixas nominais, achei ${nominal.length}`);
  const brackets: AnnexBracket[] = nominal
    .sort((a, b) => a.bracket - b.bracket)
    .map((n) => ({ bracket: n.bracket as AnnexBracket['bracket'], upToCents: n.upToCents, nominalPct: n.nominalPct, deductionCents: n.deductionCents, share: t.shares[n.bracket - 1]! }));
  return { id, annex, from, to, source, brackets, issCap: t.cap };
}

/** LC 123: Anexos II a V na redação da LC 155/2016 (a última ocorrência de cada anexo na página). */
export function parseLegacyAnnex(lc123Html: string, annex: SimplesAnnexId): AnnexPeriod {
  const text = flat(htmlToText(lc123Html));
  const head = new RegExp(`ANEXO ${ROMAN[annex]} DA LEI COMPLEMENTAR`, 'g');
  const at = [...text.matchAll(head)].map((m) => m.index!);
  if (!at.length) throw new Error(`Anexo ${annex}: não achei na LC 123`);
  const start = at[at.length - 1]!;
  const end = text.indexOf(NEXT_LC123[annex], start + 10);
  const seg = text.slice(start, end === -1 ? undefined : end);
  const where = `LC 123 Anexo ${annex}`;
  return build(`LC123-Anexo${annex}-2018`, annex, '2018-01-01', '2026-12-31', LC123.replace('{A}', annex), parseNominal(seg), parseLastShare(seg, where));
}

/** LC 214: Anexos XIX a XXII, um período por faixa de anos (2027-28, 2029, 2030, 2031, 2032, 2033 em diante). */
export function parseReformAnnex(lc214Html: string, annex: SimplesAnnexId): AnnexPeriod[] {
  const text = flat(htmlToText(lc214Html));
  const label = LC214_ANNEX[annex];
  const start = [...text.matchAll(new RegExp(`ANEXO ${label}\\b`, 'g'))].map((m) => m.index!).find((i) => /Vig[êe]ncia: 1º\/1\/2027/.test(text.slice(i, i + 900)));
  if (start === undefined) throw new Error(`Anexo ${label} da LC 214 não encontrado`);
  const end = text.indexOf(NEXT_LC214[annex], start + 10);
  const seg = text.slice(start, end === -1 ? undefined : end);

  const marks = [...seg.matchAll(/\(Vig[êe]ncia: 1º\/1\/(\d{4})(?: (?:a|até) \d{2}\/\d{2}\/(\d{4}))?\)/g)];
  const blocks = marks.map((m, i) => ({ from: m[1]!, to: m[2] ?? null, text: seg.slice(m.index!, marks[i + 1]?.index ?? seg.length) }));
  const nominalOf = (b: (typeof blocks)[number]) => (b.text.includes('Valor a Deduzir') ? parseNominal(b.text) : null);

  const nominal2027 = blocks.map(nominalOf).find((n) => n && n.length === 6);
  const nominal2029 = blocks.filter((b) => b.from === '2029' && b.to === null).map(nominalOf).find((n) => n && n.length === 6);
  if (!nominal2027 || !nominal2029) throw new Error(`Anexo ${label}: tabela de alíquotas nominais não encontrada`);

  const source = LC214.replace('{X}', label).replace('{A}', annex);
  const out: AnnexPeriod[] = [];
  const shareBlock = (year: string, to: string | null) => {
    const found = blocks.filter((b) => b.from === year && b.to === to && b.text.includes('Percentual de Reparti'));
    if (!found.length) throw new Error(`Anexo ${label}: sem repartição de ${year}`);
    return found.map((b) => b.text).join(' ');
  };

  out.push(build(`LC214-Anexo${label}-2027-2028`, annex, '2027-01-01', '2028-12-31', source, nominal2027, parseLastShare(shareBlock('2027', '2028'), `LC 214 Anexo ${label} 2027-28`)));
  for (const y of ['2029', '2030', '2031', '2032']) {
    out.push(build(`LC214-Anexo${label}-${y}`, annex, `${y}-01-01`, `${y}-12-31`, source, nominal2029, parseLastShare(shareBlock(y, y), `LC 214 Anexo ${label} ${y}`)));
  }
  out.push(build(`LC214-Anexo${label}-2033`, annex, '2033-01-01', null, source, nominal2029, parseLastShare(shareBlock('2033', null), `LC 214 Anexo ${label} 2033`)));
  return out;
}

export const SIMPLES_ANNEX_IDS: SimplesAnnexId[] = ['II', 'III', 'IV', 'V'];

export function parseAllAnnexes(lc123Html: string, lc214Html: string): AnnexPeriod[] {
  return SIMPLES_ANNEX_IDS.flatMap((a) => [parseLegacyAnnex(lc123Html, a), ...parseReformAnnex(lc214Html, a)]);
}

/** Texto TypeScript do arquivo `data/simples-anexos.ts` para os períodos. */
export function renderAnnexData(periods: AnnexPeriod[]): string {
  const share = (s: Record<SimplesTaxKey, string>) => `{ ${Object.entries(s).map(([k, v]) => `${k}: '${v}'`).join(', ')} }`;
  const lines = periods.map((p) => {
    const bs = p.brackets.map((b) => `      { bracket: ${b.bracket}, upToCents: ${b.upToCents}n, nominalPct: '${b.nominalPct}', deductionCents: ${b.deductionCents}n, share: ${share(b.share)} },`).join('\n');
    const cap = p.issCap ? `{ issPct: '${p.issCap.issPct}', bracket: 5, share: ${share(p.issCap.share)} }` : 'null';
    return `  {\n    id: '${p.id}',\n    annex: '${p.annex}',\n    from: '${p.from}',\n    to: ${p.to ? `'${p.to}'` : 'null'},\n    source: '${p.source}',\n    issCap: ${cap},\n    brackets: [\n${bs}\n    ],\n  },`;
  });
  return lines.join('\n');
}
