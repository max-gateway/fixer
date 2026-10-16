#!/usr/bin/env node
// Confere as tabelas do pacote com o texto oficial (Planalto, Confaz, Camara). Uso: npm run verify:sources [-- id ...]
// Precisa do pacote compilado (npm run build). Saida 0 = tudo bate, 1 = alguma tabela diverge, 2 = nao deu para baixar.
import { exitCode, formatReport, runChecks } from "../dist/src/verify/run.js";

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outcomes = await runChecks(only);
if (process.argv.includes("--json")) console.log(JSON.stringify(outcomes, null, 2));
else console.log(formatReport(outcomes));
process.exit(exitCode(outcomes));
