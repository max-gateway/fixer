import { CFOP } from '../../data/cfop.js';
import { CRT, CSOSN, CST_ICMS } from '../../data/cst-csosn.js';
import { IBS_CBS_REDUCED_AUTOPECAS, IBS_CBS_REFERENCE } from '../../data/ibs-cbs-referencia.js';
import { MONOFASICO_AUTOPECAS } from '../../data/monofasico-autopecas.js';
import { SIMPLES_COMERCIO } from '../../data/simples-comercio.js';
import { ST_AUTOPECAS_ANEXO_II } from '../../data/st-autopecas-anexo-ii.js';
import { ST_AUTOPECAS_PROTOCOLO } from '../../data/st-autopecas-protocolo.js';
import { decodeEntities, flat, htmlToText, pctBR, reaisBR } from './html.js';

// Cada verificação baixa o texto oficial de uma tabela, extrai de novo os dados e compara com o que o pacote tem. Serve para
// descobrir que a lei mudou (ou que a transcrição estava errada) sem depender de ninguém lembrar de conferir.

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN';
export interface CheckResult {
  status: CheckStatus;
  messages: string[];
}

export interface SourceRef {
  key: string;
  url: string;
  /** O Confaz tem uma cadeia de certificados que nem todo Node reconhece. */
  insecure?: boolean;
}

export interface Check {
  id: string;
  /** Tabela do pacote que a verificação cobre. */
  table: string;
  sources: SourceRef[];
  /** Recebe o corpo (HTML bruto) de cada fonte, pela `key`. */
  run: (docs: Record<string, string>, today: string) => CheckResult;
}

const PLANALTO = 'https://www.planalto.gov.br/ccivil_03/leis';
const CONFAZ = 'https://www.confaz.fazenda.gov.br/legislacao';
const CAMARA = 'https://www2.camara.leg.br/legin/fed/ressen';

const result = (problems: string[], warns: string[] = []): CheckResult => (problems.length ? { status: 'FAIL', messages: problems } : warns.length ? { status: 'WARN', messages: warns } : { status: 'PASS', messages: [] });
const missing = (hay: string, needles: [string, string][]) => needles.filter(([, n]) => !hay.includes(n)).map(([what]) => `não achei no texto oficial: ${what}`);
const diff = (label: string, ours: Set<string>, theirs: Set<string>): string[] => {
  const out: string[] = [];
  const onlyOurs = [...ours].filter((x) => !theirs.has(x));
  const onlyTheirs = [...theirs].filter((x) => !ours.has(x));
  if (onlyOurs.length) out.push(`${label}: só no pacote: ${onlyOurs.slice(0, 12).join(', ')}${onlyOurs.length > 12 ? '…' : ''}`);
  if (onlyTheirs.length) out.push(`${label}: só no texto oficial: ${onlyTheirs.slice(0, 12).join(', ')}${onlyTheirs.length > 12 ? '…' : ''}`);
  return out;
};

// ---------- Simples: Anexo I (LC 123) ----------

export function simplesLegacy(lc123Html: string): CheckResult {
  const text = flat(htmlToText(lc123Html));
  const legacy = SIMPLES_COMERCIO.find((p) => p.id === 'LC123-AnexoI-2018')!;
  const windows: string[] = [];
  for (const m of text.matchAll(/ANEXO I DA LEI COMPLEMENTAR/g)) windows.push(text.slice(m.index!, m.index! + 4500));
  const attempts = windows.map((w) => {
    const need: [string, string][] = [];
    for (const b of legacy.brackets) {
      need.push([`faixa ${b.bracket}: alíquota e dedução`, `${pctBR(b.nominalPct)} ${b.deductionCents === 0n ? '-' : reaisBR(b.deductionCents)}`]);
      const s = b.share;
      need.push([`faixa ${b.bracket}: repartição`, [s.irpj, s.csll, s.cofins, s.pis, s.cpp, ...(b.bracket === 6 ? [] : [s.icms])].map(pctBR).join(' ')]);
    }
    return missing(w, need);
  });
  if (!attempts.length) return result(['não achei o Anexo I da LC 123 na página']);
  const best = attempts.reduce((a, b) => (b.length < a.length ? b : a));
  return result(best);
}

// ---------- Simples: Anexo XVIII (LC 214) ----------

export function simplesReform(lc214Html: string): CheckResult {
  const text = flat(htmlToText(lc214Html));
  const start = [...text.matchAll(/ANEXO XVIII/g)].map((m) => m.index!).find((i) => /Vig[êe]ncia: 1º\/1\/2027/.test(text.slice(i, i + 600)));
  if (start === undefined) return result(['não achei o Anexo XVIII da LC 214 (Simples, comércio)']);
  const end = text.indexOf('ANEXO XIX', start);
  const seg = text.slice(start, end === -1 ? undefined : end);

  const blocks = new Map<string, string>();
  const marks = [...seg.matchAll(/Vig[êe]ncia: 1º\/1\/(\d{4})/g)];
  marks.forEach((m, i) => {
    const slice = seg.slice(m.index!, marks[i + 1]?.index ?? seg.length);
    blocks.set(m[1]!, (blocks.get(m[1]!) ?? '') + ' ' + slice);
  });

  const problems: string[] = [];
  for (const p of SIMPLES_COMERCIO.filter((x) => x.id.startsWith('LC214'))) {
    const year = p.from.slice(0, 4);
    const block = blocks.get(year);
    if (!block) {
      problems.push(`${p.id}: não achei o bloco de ${year}`);
      continue;
    }
    const need: [string, string][] = [];
    for (const b of p.brackets) {
      const s = b.share;
      const cols = b.bracket === 6 ? [s.irpj, s.csll, s.cbs, s.cpp] : year === '2033' ? [s.irpj, s.csll, s.cbs, s.cpp, s.ibs] : [s.irpj, s.csll, s.cbs, s.cpp, s.icms, s.ibs];
      need.push([`${p.id} faixa ${b.bracket}: repartição`, cols.map(pctBR).join(' ')]);
    }
    // A tabela de alíquotas nominais só é repetida em 2027 e em 2029; 2030 a 2033 trazem só a partilha.
    if (year === '2027' || year === '2029') {
      const six = p.brackets[5]!;
      need.push([`${p.id}: 6ª faixa nominal e dedução`, `${pctBR(six.nominalPct)} ${reaisBR(six.deductionCents)}`]);
    }
    problems.push(...missing(block, need));
  }
  return result(problems);
}

// ---------- Monofásico: Lei 10.485 ----------

const NCM_TOKEN = /\b(?:\d{2}\.\d{2}|\d{4}\.\d{1,2}(?:\.\d{1,2})?)\b/g;

export function monofasico(leiHtml: string): CheckResult {
  const text = htmlToText(leiHtml);
  const a1 = text.lastIndexOf('ANEXO I\n') >= 0 ? text.lastIndexOf('ANEXO I\n') : text.lastIndexOf('ANEXO I');
  const a2 = text.indexOf('ANEXO II', a1);
  if (a1 < 0 || a2 < 0) return result(['não achei os Anexos I e II da Lei 10.485']);
  const annex1 = text.slice(a1, a2).replace(/\(Reda[\s\S]*?\)/g, ' ').replace(/\(Vide[\s\S]*?\)/g, ' ');
  const theirs = new Set([...annex1.matchAll(NCM_TOKEN)].map((m) => m[0].replace(/\D/g, '')));
  const ours = new Set(MONOFASICO_AUTOPECAS.filter((e) => e.annex === 'I').map((e) => e.lawCode.replace(/\D/g, '')));
  const problems = diff('Anexo I', ours, theirs);
  const annex2 = text.slice(a2);
  const items = new Set([...annex2.matchAll(/(?:^|\n)(\d{1,2})\. /g)].map((m) => Number(m[1])));
  const oursII = MONOFASICO_AUTOPECAS.filter((e) => e.annex === 'II').length;
  if (items.size !== oursII) problems.push(`Anexo II: o texto tem ${items.size} itens numerados e o pacote ${oursII} entradas`);
  problems.push(...missing(flat(text), [['art. 5º (pneus 40.11 e 40.13)', 'posições 40.11 (pneus novos de borracha) e 40.13'], ['art. 3º, § 2º (alíquota zero do revendedor)', 'Ficam reduzidas a 0% (zero por cento) as alíquotas da contribuição para o PIS/PASEP e da COFINS, relativamente à receita bruta auferida por comerciante atacadista ou varejista']]));
  return result(problems);
}

// ---------- ST: Anexo II do Convênio 142 ----------

interface StRow {
  item: string;
  cest: string;
  ncm: string[];
}

export function parseStAnexoII(cv142Html: string): StRow[] {
  const a = cv142Html.indexOf('01.001.00');
  const b = cv142Html.indexOf('ANEXO III', a);
  if (a < 0 || b < 0) return [];
  const seg = cv142Html.slice(Math.max(0, a - 3000), b);
  const rows: StRow[] = [];
  let note: string | null = null;
  for (const tr of seg.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (tr.match(/<td[\s\S]*?<\/td>/g) ?? []).map((td) => (td.match(/<p[\s\S]*?<\/p>/g) ?? []).map((p) => decodeEntities(p.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()).filter(Boolean));
    if (cells.length === 1) {
      note = cells[0]!.join(' ');
      continue;
    }
    const item = cells[0]?.[0] ?? '';
    if (cells.length !== 4 || !/^\d+\.\d+$/.test(item)) continue;
    const old = /verde/.test(tr);
    const revoked = note !== null && /^Revogado o item/i.test(note);
    note = null;
    if (old || revoked) continue; // redação anterior ou item revogado
    rows.push({ item, cest: cells[1]![0]!, ncm: cells[2]!.flatMap((p) => p.split(' ')).filter(Boolean) });
  }
  return rows;
}

export function stAnexoII(cv142Html: string): CheckResult {
  const rows = parseStAnexoII(cv142Html);
  if (!rows.length) return result(['não achei o Anexo II (autopeças) no Convênio ICMS 142/2018']);
  const key = (r: { cest: string; ncm: string[] }) => `${r.cest} ${[...r.ncm].sort().join(' ')}`;
  return result(diff('Anexo II (CEST e NCM)', new Set(ST_AUTOPECAS_ANEXO_II.map(key)), new Set(rows.map(key))));
}

// ---------- ST: Protocolo ICMS 41/2008 ----------

const UF_BY_NAME: Record<string, string> = { Acre: 'AC', Alagoas: 'AL', 'Amapá': 'AP', Amazonas: 'AM', Bahia: 'BA', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ', Roraima: 'RR', 'Rio Grande do Sul': 'RS', 'São Paulo': 'SP', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES', Goiás: 'GO', 'Santa Catarina': 'SC' };

export function protocolo(ptHtml: string): CheckResult {
  const text = flat(htmlToText(ptHtml));
  const m = /Nova redação dada ao caput da cláusula primeira pelo Prot\. ICMS (\d+\/\d+)[^C]*Cláusula primeira (Nas operações interestaduais com bens e mercadorias relacionadas no Anexo II[\s\S]*?)Redação anterior/.exec(text);
  if (!m) return result(['não achei a redação vigente do caput da cláusula primeira do Protocolo ICMS 41/2008']);
  const last = ST_AUTOPECAS_PROTOCOLO.at(-1)!;
  const problems: string[] = [];
  const amendedBy = /\d+\/\d+/.exec(last.amendedBy)?.[0];
  if (amendedBy && m[1] !== amendedBy) problems.push(`o caput agora vem do Prot. ICMS ${m[1]} (o pacote parou no ${amendedBy}): há alteração nova`);
  const dest = /destinadas aos Estados (?:do|de|da)?\s*([\s\S]*?),? fica atribu/.exec(m[2]!);
  if (!dest) return result(['não consegui ler a lista de UFs de destino', ...problems]);
  const names = dest[1]!.replace(/\s+e o Distrito Federal/, ', Distrito Federal').replace(/\s+e\s+/g, ', ').split(',').map((x) => x.replace(/^(do|de|da|o)\s+/i, '').trim()).filter(Boolean);
  const ufs = new Set(names.map((n) => UF_BY_NAME[n] ?? `?${n}`));
  problems.push(...diff('UFs de destino', new Set(last.destinations), ufs));
  const exceptions = m[2]!.slice(0, m[2]!.indexOf('destinadas'));
  const cests = new Set([...exceptions.matchAll(/\d\d\.\d{3}\.\d\d/g)].map((x) => x[0]));
  problems.push(...diff('CEST excetuados', new Set(last.excludedCest), cests));
  return result(problems);
}

// ---------- CFOP ----------

/** Versões de CFOP que o Confaz lista no menu; uma nova no menu significa que o CFOP mudou. */
export const KNOWN_CFOP_PAGES = ['cfop_cvsn_70_anterior', 'cfop_cvsn_70_vigente', 'cvsn_70', 'cvsinief_006_89', 'cfop_cvsn_70_vigente_nova', 'CFOP_CVSN_1.6.22_31.03.24', 'CFOP_CVSN_AnII-A_3.4.23', 'CFOP_CVSN_1.6.24'];

export function cfop(pageHtml: string): CheckResult {
  const text = htmlToText(pageHtml);
  const start = text.indexOf('ANEXO II');
  if (start < 0) return result(['não achei o Anexo II (CFOP) na página']);
  const body = text.slice(start);
  const theirs = new Set([...body.matchAll(/(?:^|\n)(\d\.\d{3}) - /g)].map((m) => m[1]!.replace('.', '')));
  const problems = diff('CFOP', new Set(CFOP.map((c) => c.code)), theirs);
  const menu = text.slice(0, start);
  const found = [...menu.matchAll(/\b(cfop_cvsn[\w.\-]*|CFOP_CVSN[\w.\-]*|cvsn_70|cvsinief_006_89)\b/g)].map((m) => m[1]!);
  const unknown = [...new Set(found)].filter((f) => !KNOWN_CFOP_PAGES.some((k) => k.toLowerCase() === f.toLowerCase()));
  if (unknown.length) problems.push(`o Confaz publicou nova versão do CFOP: ${unknown.join(', ')}`);
  return result(problems);
}

// ---------- CST, CSOSN, CRT ----------

export function cst(pageHtml: string): CheckResult {
  const text = htmlToText(pageHtml).replace(/\s+/g, ' ');
  const b0 = text.indexOf('Tabela B - Tributação pelo ICMS');
  const b1 = text.indexOf('NOTA EXPLICATIVA', b0);
  if (b0 < 0 || b1 < 0) return result(['não achei a Tabela B de CST']);
  // A tabela vem como "00 | Tributada integralmente ... | 02 | ...": o código e a descrição são células vizinhas.
  const rows = [...text.slice(b0, b1).matchAll(/(?:^|\|) (\d{2}) \| ([^|]*)/g)];
  const revoked = new Set(rows.filter((m) => /^REVOGADO/.test(m[2]!.trim())).map((m) => m[1]!));
  const theirs = new Set(rows.map((m) => m[1]!).filter((c) => !revoked.has(c)));
  const problems = diff('CST (Tabela B)', new Set(CST_ICMS.map((c) => c.code)), theirs);

  const c0 = text.indexOf('ANEXO III-A');
  const c1 = text.indexOf('NOTA EXPLICATIVA', c0);
  const csosn = new Set(c0 < 0 ? [] : [...text.slice(c0, c1).matchAll(/\| (\d{3}) \|/g)].map((m) => m[1]!));
  problems.push(...diff('CSOSN', new Set(CSOSN.map((c) => c.code)), csosn));

  const r0 = text.indexOf('CÓDIGO DE REGIME TRIBUTÁRIO');
  const crt = new Set(r0 < 0 ? [] : [...text.slice(r0, r0 + 400).matchAll(/(?:^|\s)([1-4]) - /g)].map((m) => m[1]!));
  problems.push(...diff('CRT', new Set(CRT.map((c) => c.code)), crt));
  return result(problems);
}

// ---------- Frases-chave das leis (alíquotas) ----------

type Phrase = [string, string];
const phrases = (html: string, list: Phrase[]) => result(missing(flat(htmlToText(html)), list));

export const interestadual22 = (h: string) => phrases(h, [['12% (doze por cento) como alíquota geral', 'será de doze por cento'], ['7% (sete) a partir de 1990 do Sul/Sudeste', 'II - a partir de 1990, sete por cento'], ['regiões do 7%', 'Regiões Norte, Nordeste e Centro-Oeste e ao Estado do Espírito Santo']]);
export const interestadual13 = (h: string) => phrases(h, [['4% para importados', 'será de 4% (quatro por cento)'], ['vigência em 2013-01-01', 'Esta Resolução entra em vigor em 1º de janeiro de 2013'], ['limite de 40% de conteúdo de importação', 'superior a 40% (quarenta por cento)']]);

export const federal = (docs: Record<string, string>): CheckResult => {
  const problems: string[] = [];
  const need = (key: string, list: Phrase[]) => problems.push(...missing(flat(htmlToText(docs[key] ?? '')), list));
  need('l9249', [['IRPJ: base de 8% (art. 15)', 'percentual de 8% (oito por cento) sobre a receita bruta'], ['IRPJ: alíquota de 15% (art. 3º)', 'A alíquota do imposto de renda das pessoas jurídicas é de quinze por cento'], ['CSLL: base de 12% (art. 20)', 'corresponderá a 12% (doze por cento) sobre a receita bruta'], ['adicional: R$ 20.000 por mês', 'multiplicação de R$ 20.000,00 (vinte mil reais) pelo número de meses']]);
  need('l7689', [['CSLL 9% (art. 3º, II)', '9% (nove por cento), no caso das demais pessoas jurídicas']]);
  need('l9718', [['Cofins 3% (art. 8º)', 'Fica elevada para três por cento a alíquota da COFINS']]);
  need('l9715', [['PIS 0,65% sobre o faturamento (art. 8º, I)', 'zero vírgula sessenta e cinco por cento sobre o faturamento']]);
  need('l10637', [['PIS não cumulativo 1,65% (art. 2º)', 'a alíquota de 1,65% (um inteiro e sessenta e cinco centésimos por cento)']]);
  need('l10833', [['Cofins não cumulativa 7,6% (art. 2º)', 'a alíquota de 7,6% (sete inteiros e seis décimos por cento)']]);
  need('lc224', [['majoração de 10% na presunção', 'acréscimo de 10% (dez por cento) nos percentuais de presunção'], ['limite de R$ 5 milhões', 'R$ 5.000.000,00 (cinco milhões de reais)'], ['vigência em 2026-01-01', 'a partir de 1º de janeiro de 2026, em relação aos demais dispositivos']]);
  const lc214 = flat(htmlToText(docs['lc214'] ?? ''));
  const rev = lc214.slice(lc214.indexOf('Ficam revogados a partir de 1º de janeiro de 2027'), lc214.indexOf('Ficam revogados a partir de 1º de janeiro de 2033'));
  for (const lei of ['Lei nº 9.715', 'Lei nº 9.718', 'Lei nº 10.637', 'Lei nº 10.833', 'Lei nº 10.485']) if (!rev.includes(lei)) problems.push(`a LC 214 não revoga mais a ${lei} em 2027-01-01 (a tabela federal-lucro assume que sim)`);
  return result(problems);
};

// ---------- Reforma: LC 214 ----------

/** NCM de anexos da LC 214 que cruzam com autopeças e que já foram avaliados à mão (descrições conferidas). Um NCM novo precisa de revisão. */
export const REVIEWED_ANNEX_OVERLAPS = new Set([
  '391740', // Anexo IV: conectores médicos; o CEST 01.002.00 é tubo plástico de veículo
  '84212990', // Anexo IV: filtros de sangue; o CEST de filtros é de óleo e combustível
  '90251990', '90259010', // Anexo V: termômetro com voz; o CEST de termômetros é de painel de veículo
  '85171', // Anexo V, item 3.1: telefone com visor para surdos; o CEST 01.056.00 é telefone móvel para veículo
  '87082999', '87089910', // Anexo V, item 1: adaptações para pessoas com deficiência (estão em ibs-cbs-referencia)
]);

/** Prazo do Senado para fixar a alíquota de referência do ano seguinte (art. 349, § 1º, II): passou e o pacote segue sem o número. */
export function referenceDeadlineWarnings(today: string, refs = IBS_CBS_REFERENCE): string[] {
  return refs
    .filter((r) => r.status === 'PENDENTE' && today > r.senateDeadline && r.year === Number(today.slice(0, 4)) + 1)
    .map((r) => `passou o prazo do Senado (${r.senateDeadline}) e a alíquota de referência de ${r.year} segue PENDENTE no pacote: conferir a resolução do Senado e preencher ibs-cbs-referencia`);
}

export function reform(lc214Html: string, today: string): CheckResult {
  const text = flat(htmlToText(lc214Html));
  const problems = missing(text, [
    ['art. 343: IBS 0,1% em 2026', 'a alíquota estadual de 0,1% (um décimo por cento)'],
    ['art. 346: CBS 0,9% em 2026', 'a alíquota de 0,9% (nove décimos por cento)'],
    ['art. 344: IBS 0,05% + 0,05% em 2027-2028', 'à alíquota estadual de 0,05% (cinco centésimos por cento) e à alíquota municipal de 0,05%'],
    ['art. 347: CBS reduzida em 0,1 ponto', 'reduzida em 0,1 (um décimo) ponto percentual'],
    ['art. 348, III, c: Simples fora em 2026', 'não serão aplicadas em relação às operações dos contribuintes optantes pelo Simples Nacional'],
    ['art. 501: ICMS -10% em 2029', 'I - 10% (dez por cento), em 2029'],
    ['art. 501: ICMS -40% em 2032', 'IV - 40% (quarenta por cento), em 2032'],
    ['art. 349: prazo do Senado', 'o Senado Federal fixará as alíquotas de referência e o redutor até o dia 31 de outubro do ano anterior'],
    ['art. 519: Anexos I a V do Simples', 'Anexos I a V da Lei Complementar nº 123, de 14 de dezembro de 2006, passam a vigorar com a redação dos Anexos XVIII a XXII'],
  ]);

  // Anexos I a XVI x NCM de autopeças (Anexo II do Convênio 142): o que cruza precisa já ter sido avaliado.
  const a = text.indexOf('PRODUTOS DESTINADOS À ALIMENTAÇÃO HUMANA');
  const b = text.indexOf('ANEXO XVIII', a);
  if (a < 0 || b < 0) {
    problems.push('não achei os Anexos I a XVI da LC 214');
  } else {
    const annexCodes = new Set([...text.slice(a, b).matchAll(/\b(?:\d{2}\.\d{2}(?:\.\d{2}(?:\.\d{2})?)?|\d{4}(?:\.\d{1,2}){0,2}|\d{4})\b/g)].map((m) => m[0].replace(/\D/g, '')).filter((c) => c.length >= 4));
    const autoNcm = new Set(ST_AUTOPECAS_ANEXO_II.flatMap((i) => i.ncm.map((n) => n.replace(/\D/g, ''))));
    const overlaps = new Set<string>();
    for (const p of autoNcm) for (const c of annexCodes) if (p.length >= 4 && c.length >= 4 && (c.startsWith(p) || p.startsWith(c))) overlaps.add(c.length >= p.length ? c : p);
    const fresh = [...overlaps].filter((c) => ![...REVIEWED_ANNEX_OVERLAPS].some((r) => r.startsWith(c) || c.startsWith(r)));
    if (fresh.length) problems.push(`NCM de autopeça em anexo de redução da LC 214, ainda não avaliado: ${fresh.join(', ')}`);
    const ours = new Set(IBS_CBS_REDUCED_AUTOPECAS.flatMap((i) => i.ncm.map((n) => n.replace(/\D/g, ''))));
    for (const n of ours) if (!annexCodes.has(n)) problems.push(`o NCM ${n} saiu dos anexos de redução da LC 214 (a tabela ibs-cbs-referencia ainda o lista)`);
  }

  const warns = referenceDeadlineWarnings(today);
  return result(problems, warns);
}

// ---------- Lista de verificações ----------

export const CHECKS: Check[] = [
  { id: 'simples-anexo-i', table: 'simples-comercio', sources: [{ key: 'lc123', url: `${PLANALTO}/lcp/lcp123.htm` }], run: (d) => simplesLegacy(d.lc123!) },
  { id: 'simples-anexo-xviii', table: 'simples-comercio', sources: [{ key: 'lc214', url: `${PLANALTO}/lcp/lcp214.htm` }], run: (d) => simplesReform(d.lc214!) },
  { id: 'monofasico', table: 'monofasico-autopecas', sources: [{ key: 'lei', url: `${PLANALTO}/2002/l10485compilado.htm` }], run: (d) => monofasico(d.lei!) },
  { id: 'st-anexo-ii', table: 'st-autopecas-anexo-ii', sources: [{ key: 'cv142', url: `${CONFAZ}/convenios/2018/CV142_18`, insecure: true }], run: (d) => stAnexoII(d.cv142!) },
  { id: 'st-protocolo', table: 'st-autopecas-protocolo', sources: [{ key: 'pt41', url: `${CONFAZ}/protocolos/2008/pt041_08`, insecure: true }], run: (d) => protocolo(d.pt41!) },
  { id: 'cfop', table: 'cfop', sources: [{ key: 'cfop', url: `${CONFAZ}/ajustes/sinief/cfop_cvsn_1-6.24`, insecure: true }], run: (d) => cfop(d.cfop!) },
  { id: 'cst-csosn', table: 'cst-csosn', sources: [{ key: 'cvsn70', url: `${CONFAZ}/ajustes/sinief/cvsn_70`, insecure: true }], run: (d) => cst(d.cvsn70!) },
  { id: 'interestadual-22', table: 'icms-interestadual', sources: [{ key: 'r22', url: `${CAMARA}/1989/resolucao-22-19-maio-1989-481183-publicacaooriginal-1-pl.html` }], run: (d) => interestadual22(d.r22!) },
  { id: 'interestadual-13', table: 'icms-interestadual', sources: [{ key: 'r13', url: `${CAMARA}/2012/resolucao-13-25-abril-2012-612768-publicacaooriginal-135841-pl.html` }], run: (d) => interestadual13(d.r13!) },
  {
    id: 'federal-lucro',
    table: 'federal-lucro',
    sources: [
      { key: 'l9249', url: `${PLANALTO}/l9249.htm` },
      { key: 'l7689', url: `${PLANALTO}/l7689.htm` },
      { key: 'l9718', url: `${PLANALTO}/l9718compilada.htm` },
      { key: 'l9715', url: `${PLANALTO}/l9715.htm` },
      { key: 'l10637', url: `${PLANALTO}/2002/l10637.htm` },
      { key: 'l10833', url: `${PLANALTO}/2003/l10.833compilado.htm` },
      { key: 'lc224', url: `${PLANALTO}/lcp/lcp224.htm` },
      { key: 'lc214', url: `${PLANALTO}/lcp/lcp214.htm` },
    ],
    run: (d) => federal(d),
  },
  { id: 'reforma', table: 'ibs-cbs-transition + ibs-cbs-referencia', sources: [{ key: 'lc214', url: `${PLANALTO}/lcp/lcp214.htm` }], run: (d, today) => reform(d.lc214!, today) },
];
