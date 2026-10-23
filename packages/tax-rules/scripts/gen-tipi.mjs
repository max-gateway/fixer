// Gera `data/tipi.ts` a partir da planilha oficial da Receita (TIPI atualizada). Uso: `npm run gen:tipi`.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseTipi, renderTipiTable } from '../dist/src/verify/tipi-parse.js';

const URL_TIPI = 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/documentos-e-arquivos/tipi.xlsx';
const res = await fetch(URL_TIPI, { headers: { 'user-agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`${URL_TIPI}: HTTP ${res.status}`);
const parsed = parseTipi(Buffer.from(await res.arrayBuffer()));

const out = new URL('../data/tipi.ts', import.meta.url);
const current = readFileSync(out, 'utf8');
const start = current.indexOf('// <generated>');
const end = current.indexOf('// </generated>');
if (start === -1 || end === -1) throw new Error('marcadores // <generated> não encontrados em data/tipi.ts');
const block = `// <generated>\nexport const TIPI_LAST_UPDATE = { act: ${JSON.stringify(parsed.lastUpdate.act)}, date: '${parsed.lastUpdate.date}' };\nexport const TIPI_TABLE = \`${renderTipiTable(parsed.entries)}\`;\n`;
writeFileSync(out, current.slice(0, start) + block + current.slice(end));
console.log(`${parsed.entries.length} linhas da TIPI; última atualização: ${parsed.lastUpdate.act} (${parsed.lastUpdate.date})`);
