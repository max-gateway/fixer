// Gera `data/ibs-cbs-reducoes.ts` a partir da LC 214/2025 (Planalto, Anexos I a XV). Uso: `npm run gen:reducoes`.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseReductions, renderReductions } from '../dist/src/verify/reducoes-parse.js';

const url = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm';
const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const bytes = new Uint8Array(await res.arrayBuffer());
let html;
try {
  html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
} catch {
  html = new TextDecoder('windows-1252').decode(bytes);
}
const items = parseReductions(html);

const out = new URL('../data/ibs-cbs-reducoes.ts', import.meta.url);
const current = readFileSync(out, 'utf8');
const start = current.indexOf('// <generated>');
const end = current.indexOf('// </generated>');
if (start === -1 || end === -1) throw new Error('marcadores // <generated> não encontrados em data/ibs-cbs-reducoes.ts');
writeFileSync(out, `${current.slice(0, start)}// <generated>\n${renderReductions(items)}\n  ${current.slice(end)}`);
const by = {};
for (const it of items) by[it.annex] = (by[it.annex] ?? 0) + 1;
console.log(`${items.length} itens gravados:`, JSON.stringify(by));
