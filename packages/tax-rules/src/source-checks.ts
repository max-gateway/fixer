import { SOURCE_CHECKS } from '../data/source-checks.js';
import type { TableMeta } from './types.js';

// Conferência automática com a fonte oficial (docs/specs/tax-rules.md §6). Uma tabela cuja versão em uso passou em todas
// as verificações de `verify:sources` conta como validada pela fonte, sem depender do aceite do contador.

export interface SourceCheckStamp {
  /** Versão da tabela que passou na conferência. */
  version: string;
  /** Data (AAAA-MM-DD) da conferência. */
  checkedAt: string;
  /** Verificações de `verify:sources` que passaram. */
  checks: string[];
}

/** Resultado de uma verificação, no formato de `runChecks` (`table` pode juntar tabelas com " + "). */
export interface StampOutcome {
  id: string;
  table: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'ERROR';
}

/** Carimbo da versão em uso, ou null quando a tabela nunca passou ou mudou de versão depois da conferência. */
export function sourceCheck(meta: Pick<TableMeta, 'id' | 'version'>, stamps: Record<string, SourceCheckStamp> = SOURCE_CHECKS): SourceCheckStamp | null {
  const s = stamps[meta.id];
  return s && s.version === meta.version ? s : null;
}

/**
 * Novos carimbos a partir de uma rodada de verificação. Tabela com todas as verificações em PASS ganha carimbo de hoje;
 * FAIL ou WARN derruba o carimbo; ERROR (rede) mantém o anterior, porque não diz nada sobre o conteúdo.
 */
export function nextStamps(outcomes: StampOutcome[], tables: Pick<TableMeta, 'id' | 'version'>[], previous: Record<string, SourceCheckStamp>, today: string): Record<string, SourceCheckStamp> {
  const byTable = new Map<string, StampOutcome[]>();
  for (const o of outcomes) for (const t of o.table.split('+').map((x) => x.trim())) byTable.set(t, [...(byTable.get(t) ?? []), o]);
  const out: Record<string, SourceCheckStamp> = {};
  for (const t of tables) {
    const results = byTable.get(t.id);
    const prev = previous[t.id];
    if (!results?.length) {
      if (prev) out[t.id] = prev;
      continue;
    }
    if (results.some((r) => r.status === 'FAIL' || r.status === 'WARN')) continue;
    if (results.some((r) => r.status === 'ERROR')) {
      if (prev) out[t.id] = prev;
      continue;
    }
    out[t.id] = { version: t.version, checkedAt: today, checks: results.map((r) => r.id).sort() };
  }
  return out;
}

/** Texto de `data/source-checks.ts` para os carimbos dados. */
export function renderStamps(stamps: Record<string, SourceCheckStamp>): string {
  const lines = Object.keys(stamps)
    .sort()
    .map((id) => {
      const s = stamps[id]!;
      return `  '${id}': { version: '${s.version}', checkedAt: '${s.checkedAt}', checks: [${s.checks.map((c) => `'${c}'`).join(', ')}] },`;
    });
  return [
    '// Gerado por `npm run verify:sources -- --stamp`: não editar à mão.',
    '//',
    '// Última conferência automática de cada tabela com o texto oficial (docs/specs/tax-rules.md §6). O carimbo vale só para a',
    '// versão conferida: mudou a versão da tabela, ele deixa de valer até a próxima conferência passar.',
    '',
    "import type { SourceCheckStamp } from '../src/source-checks.js';",
    '',
    lines.length ? `export const SOURCE_CHECKS: Record<string, SourceCheckStamp> = {\n${lines.join('\n')}\n};` : 'export const SOURCE_CHECKS: Record<string, SourceCheckStamp> = {};',
    '',
  ].join('\n');
}
