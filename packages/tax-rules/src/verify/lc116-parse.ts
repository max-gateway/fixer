import type { Lc116Item } from '../../data/iss-lc116.js';
import { htmlToText } from './html.js';

// Extrai a lista de serviços anexa à LC 116/2003 (subitens "14.01 – Lubrificação, limpeza..."). A página traz a redação antiga e a nova
// do mesmo subitem em sequência ("1.03 – ...", depois "1.03 - ... (Redação dada pela LC 157/2016)"): vale a última. O mesmo parser gera
// `data/iss-lc116.ts` (scripts/gen-lc116.mjs) e o confere (verify:sources).

// O Planalto escreve o travessão como &#150; (Windows-1252), que vira o caractere de controle U+0096.
const DASH = '[–\\u0096-]';
const CODE_LINE = new RegExp(`^(\\d{1,2}\\.\\d{2})\\s*${DASH}\\s*(.*)$`);
const GROUP_LINE = new RegExp(`^(\\d{1,2})\\s*${DASH}\\s*(.*)$`);
const NOTE = /\((?:Reda[çc][ãa]o dada|Inclu[ií]d[oa]|Vide|Revogad[oa]|VETAD[OA]|Renumerad|Vig[êe]ncia|Produ[çc][ãa]o)[^)]*\)?/gi;

export function parseLc116Items(lc116Html: string): { items: Lc116Item[]; groups: Record<string, string> } {
  const text = htmlToText(lc116Html);
  const start = text.indexOf('Lista de serviços anexa à Lei');
  if (start < 0) throw new Error('lista de serviços da LC 116 não encontrada');
  const lines = text.slice(start).split('\n').slice(1);

  const byCode = new Map<string, { raw: string[]; flags: string }>();
  const groups: Record<string, string> = {};
  let current: { raw: string[]; flags: string } | null = null;
  let currentGroup: string | null = null;
  for (const line of lines) {
    const code = CODE_LINE.exec(line);
    const group = !code ? GROUP_LINE.exec(line) : null;
    if (code) {
      current = { raw: [code[2]!], flags: '' };
      byCode.set(code[1]!, current); // a redação posterior substitui a anterior
      currentGroup = null;
    } else if (group && Number(group[1]) >= 1 && Number(group[1]) <= 40 && !line.startsWith('*')) {
      groups[group[1]!] = group[2]!.replace(NOTE, '').replace(/\s+/g, ' ').trim();
      currentGroup = group[1]!;
      current = null;
    } else if (current && line !== '*') {
      current.raw.push(line);
    }
    void currentGroup;
  }
  const items: Lc116Item[] = [];
  for (const [code, v] of byCode) {
    const full = v.raw.join(' ');
    const revoked = /\((?:Revogad[oa]|VETAD[OA])/i.test(full);
    const description = full.replace(NOTE, '').replace(/\s+/g, ' ').trim();
    items.push({ code, group: code.split('.')[0]!, description, revoked });
  }
  if (items.length < 200) throw new Error(`lista da LC 116 com ${items.length} subitens: esperava mais de 200`);
  items.sort((a, b) => Number(a.code.split('.')[0]) - Number(b.code.split('.')[0]) || a.code.localeCompare(b.code));
  return { items, groups };
}

export function renderLc116(items: Lc116Item[], groups: Record<string, string>): string {
  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const itemLines = items.map((i) => `  { code: ${q(i.code)}, group: ${q(i.group)}, description: ${q(i.description)}, revoked: ${i.revoked} },`).join('\n');
  const groupLines = Object.entries(groups).map(([k, v]) => `  ${q(k)}: ${q(v)},`).join('\n');
  return `export const LC116_ITEMS: Lc116Item[] = [\n${itemLines}\n];\n\nexport const LC116_GROUPS: Record<string, string> = {\n${groupLines}\n};`;
}
