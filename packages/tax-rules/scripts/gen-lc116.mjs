// Gera a lista de serviços de `data/iss-lc116.ts` a partir da LC 116/2003 (Planalto). Uso: `npm run gen:lc116`.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLc116Items, renderLc116 } from '../dist/src/verify/lc116-parse.js';

const url = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm';
const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const bytes = new Uint8Array(await res.arrayBuffer());
let html;
try {
  html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
} catch {
  html = new TextDecoder('windows-1252').decode(bytes);
}
const { items, groups } = parseLc116Items(html);

const out = new URL('../data/iss-lc116.ts', import.meta.url);
const current = readFileSync(out, 'utf8');
const start = current.indexOf('// <generated>');
const end = current.indexOf('// </generated>');
if (start === -1 || end === -1) throw new Error('marcadores // <generated> não encontrados em data/iss-lc116.ts');
writeFileSync(out, `${current.slice(0, start)}// <generated>\n${renderLc116(items, groups)}\n${current.slice(end)}`);
console.log(`${items.length} subitens (${items.filter((i) => i.revoked).length} vetados/revogados) em ${Object.keys(groups).length} itens`);
