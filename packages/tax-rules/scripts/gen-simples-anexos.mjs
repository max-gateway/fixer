// Gera `data/simples-anexos.ts` a partir do texto oficial (LC 123 e LC 214, Planalto). Uso: `npm run gen:simples-anexos`.
// O parser é o mesmo que `verify:sources` usa para conferir o arquivo, então regenerar e conferir dão o mesmo resultado.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAllAnnexes, renderAnnexData } from '../dist/src/verify/simples-parse.js';

const UA = { 'user-agent': 'Mozilla/5.0' };
const get = async (url) => {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
};

const base = 'https://www.planalto.gov.br/ccivil_03/leis/lcp';
const [lc123, lc214] = await Promise.all([get(`${base}/lcp123.htm`), get(`${base}/lcp214.htm`)]);
const periods = parseAllAnnexes(lc123, lc214);

const out = new URL('../data/simples-anexos.ts', import.meta.url);
const current = (await import('node:fs')).readFileSync(out, 'utf8');
const start = current.indexOf('// <generated>');
const end = current.indexOf('// </generated>');
if (start === -1 || end === -1) throw new Error('marcadores // <generated> não encontrados em data/simples-anexos.ts');
const next = `${current.slice(0, start)}// <generated>\n${renderAnnexData(periods)}\n  ${current.slice(end)}`;
writeFileSync(out, next);
console.log(`${periods.length} períodos gravados em ${fileURLToPath(out)}`);
