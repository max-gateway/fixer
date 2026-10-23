#!/usr/bin/env node
// Confere as tabelas do pacote com o texto oficial (Planalto, Confaz, Camara). Uso: npm run verify:sources [-- id ...]
// Precisa do pacote compilado (npm run build). Saida 0 = tudo bate, 1 = alguma tabela diverge, 2 = nao deu para baixar.
// --stamp: grava em data/source-checks.ts a conferencia de cada tabela (vale como validacao pela fonte; tax-rules.md §6).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TABLES } from "../dist/index.js";
import { SOURCE_CHECKS } from "../dist/data/source-checks.js";
import { nextStamps, renderStamps } from "../dist/src/source-checks.js";
import { exitCode, formatReport, runChecks } from "../dist/src/verify/run.js";

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outcomes = await runChecks(only);
if (process.argv.includes("--json")) console.log(JSON.stringify(outcomes, null, 2));
else console.log(formatReport(outcomes));
if (process.argv.includes("--stamp")) {
  const today = new Date().toISOString().slice(0, 10);
  const stamps = nextStamps(outcomes, TABLES, SOURCE_CHECKS, today);
  writeFileSync(fileURLToPath(new URL("../data/source-checks.ts", import.meta.url)), renderStamps(stamps));
  console.log(`\n${Object.keys(stamps).length} tabela(s) com conferencia valida gravadas em data/source-checks.ts`);
}
process.exit(exitCode(outcomes));
