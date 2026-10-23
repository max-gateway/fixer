import type { ReductionItem } from '../../data/ibs-cbs-reducoes.js';
import { htmlToText } from './html.js';

// Extrai da LC 214/2025 os Anexos I a XV (bens e serviços com alíquota de IBS/CBS reduzida a zero ou em 60%). O mesmo parser gera
// `data/ibs-cbs-reducoes.ts` (scripts/gen-reducoes.mjs) e o confere (verify:sources). O texto da lei é livre ("códigos 0401.10.10 e
// 0401.20.10", "posição 09.01", "Capítulo 31", "exceto..."), então o resultado são CANDIDATOS: o código casa, mas a condição legal
// (requisitos da legislação específica, ressalvas) só quem classifica o produto confirma. Nunca é aplicado sozinho.

const ANNEXES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

function reductionOf(heading: string): number | null {
  if (/REDU[ÇC][ÃA]O A ZERO/i.test(heading)) return 100;
  const m = /REDU[ÇC][ÃA]O DE (\d+)%/i.exec(heading);
  return m ? Number(m[1]) : null;
}

const isId = (s: string) => /^\d{1,3}(\.\d{1,2})?$/.test(s);

/** Ids que podem vir depois de `id` na tabela: o próximo filho (1 -> 1.1), o irmão (1.1 -> 1.2) ou o próximo item (1.13 -> 2). */
function nextIds(id: string): string[] {
  const [major, minor] = id.split('.');
  const next = String(Number(major) + 1);
  return minor === undefined ? [`${major}.1`, next] : [`${major}.${Number(minor) + 1}`, next];
}

/** Códigos de NBS (1.dddd.dd.dd) e de NCM (capítulo, posição, subposição, código) citados num texto, só os dígitos. */
export function extractCodes(text: string): { ncm: string[]; nbs: string[] } {
  const nbs = new Set<string>();
  let rest = text.replace(/\b1\.\d{4}(?:\.\d{1,2}){0,3}\b/g, (m) => {
    nbs.add(m.replace(/\./g, ''));
    return ' ';
  });
  const ncm = new Set<string>();
  rest = rest.replace(/Cap[ií]tulos?\s+(\d{1,2})\b/gi, (_m, c: string) => {
    ncm.add(c.padStart(2, '0'));
    return ' ';
  });
  rest = rest.replace(/\b(\d{4})\.(\d{1,2})(?:\.(\d{1,2}))?\b/g, (_m, a: string, b: string, c?: string) => {
    ncm.add(a + b + (c ?? ''));
    return ' ';
  });
  rest.replace(/\b(\d{2})\.(\d{2})\b/g, (_m, a: string, b: string) => {
    ncm.add(a + b);
    return ' ';
  });
  return { ncm: [...ncm].sort(), nbs: [...nbs].sort() };
}

/** Lê os Anexos I a XV (anexos dos produtos e serviços reduzidos) e devolve um item por linha da tabela. */
export function parseReductions(lc214Html: string): ReductionItem[] {
  const text = htmlToText(lc214Html);
  const heads = [...text.matchAll(/^ANEXO ([IVX]+)\s*$/gm)].map((m) => ({ annex: m[1]!, at: m.index! }));
  // A primeira sequência I..XVI (a segunda, XVIII em diante, é do Simples e repete numerais).
  const start = heads.findIndex((h) => h.annex === 'I');
  const out: ReductionItem[] = [];
  for (const annex of ANNEXES) {
    const idx = heads.findIndex((h, i) => i >= start && h.annex === annex);
    if (idx < 0) throw new Error(`Anexo ${annex} da LC 214 não encontrado`);
    const next = heads[idx + 1];
    const seg = text.slice(heads[idx]!.at, next?.at);
    const itemAt = seg.search(/^ITEM\s*\|/m);
    if (itemAt < 0) throw new Error(`Anexo ${annex}: cabeçalho ITEM não encontrado`);
    const heading = seg.slice(0, itemAt).replace(/\s+/g, ' ').trim();
    const reduction = reductionOf(heading);
    if (reduction === null) throw new Error(`Anexo ${annex}: redução não encontrada em "${heading}"`);
    if (/Revogado/i.test(heading)) continue; // Anexo XIV (medicamentos) revogado pela LC 227/2026

    const cells = seg
      .slice(itemAt)
      .split(/ ?\|\n/)
      .map((c) => c.replace(/\s+/g, ' ').trim())
      .filter((c, i, a) => c !== '' || i < a.length - 1);
    const firstId = cells.findIndex((c) => c === '1');
    const columns = firstId; // ITEM | DESCRIÇÃO [| NCM/SH]
    if (columns < 2 || columns > 3) throw new Error(`Anexo ${annex}: ${columns} colunas no cabeçalho`);

    let expected = ['1'];
    let i = firstId;
    let group = '';
    while (i < cells.length && expected.includes(cells[i]!)) {
      const id = cells[i]!;
      const description = cells[i + 1] ?? '';
      i += 2;
      let codeCell = '';
      // Um item pode ter várias linhas de código (uma célula cada): consome até aparecer o id seguinte.
      while (columns === 3 && i < cells.length && !nextIds(id).includes(cells[i]!)) codeCell += ` ${cells[i++]!}`;
      codeCell = codeCell.trim();
      const hasChildren = columns === 3 && codeCell === '' && cells[i] === `${id}.1`;
      if (hasChildren) {
        group = description; // linha de grupo (p.ex. Anexo V, "1 ACESSÓRIOS E ADAPTAÇÕES..."): sem código próprio
      } else {
        const codes = extractCodes(columns === 3 ? codeCell : description);
        out.push({ annex, reductionPct: String(reduction), item: id, description: description.length > 220 ? `${description.slice(0, 217)}...` : description, group: group && id.includes('.') ? group : null, ncm: codes.ncm, nbs: codes.nbs });
      }
      expected = nextIds(id);
      if (!isId(cells[i] ?? '') && !expected.includes(cells[i] ?? '')) break;
    }
    const leftover = cells.slice(i).filter(Boolean);
    if (leftover.length) throw new Error(`Anexo ${annex}: parei no item ${expected.join('/')} com ${leftover.length} célula(s) sem ler: "${leftover[0]!.slice(0, 80)}"`);
    const last = out.filter((o) => o.annex === annex).length;
    if (last === 0) throw new Error(`Anexo ${annex}: nenhum item lido`);
  }
  return out;
}

/** Texto TypeScript do arquivo `data/ibs-cbs-reducoes.ts`. */
export function renderReductions(items: ReductionItem[]): string {
  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const arr = (a: string[]) => `[${a.map(q).join(', ')}]`;
  return items.map((it) => `  { annex: ${q(it.annex)}, reductionPct: ${q(it.reductionPct)}, item: ${q(it.item)}, group: ${it.group ? q(it.group) : 'null'}, description: ${q(it.description)}, ncm: ${arr(it.ncm)}, nbs: ${arr(it.nbs)} },`).join('\n');
}
