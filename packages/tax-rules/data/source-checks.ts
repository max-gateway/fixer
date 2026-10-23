// Gerado por `npm run verify:sources -- --stamp`: não editar à mão.
//
// Última conferência automática de cada tabela com o texto oficial (docs/specs/tax-rules.md §6). O carimbo vale só para a
// versão conferida: mudou a versão da tabela, ele deixa de valer até a próxima conferência passar.

import type { SourceCheckStamp } from '../src/source-checks.js';

export const SOURCE_CHECKS: Record<string, SourceCheckStamp> = {
  'cfop': { version: '2026-02-01.1', checkedAt: '2026-10-22', checks: ['cfop'] },
  'cnae-lc116': { version: '2026-10-19.2', checkedAt: '2026-10-22', checks: ['cnae-lc116'] },
  'cst-csosn': { version: '2026-10-13.1', checkedAt: '2026-10-22', checks: ['cst-csosn'] },
  'federal-lucro': { version: '2026-10-22.4', checkedAt: '2026-10-22', checks: ['federal-lucro'] },
  'ibs-cbs-reducoes': { version: '2026-10-22.1', checkedAt: '2026-10-22', checks: ['ibs-cbs-reducoes'] },
  'ibs-cbs-referencia': { version: '2026-10-13.1', checkedAt: '2026-10-22', checks: ['reforma'] },
  'ibs-cbs-transition': { version: '2026-10-22.1', checkedAt: '2026-10-22', checks: ['reforma'] },
  'icms-interestadual': { version: '2026-10-13.1', checkedAt: '2026-10-22', checks: ['interestadual-13', 'interestadual-22'] },
  'imposto-seletivo': { version: '2026-10-22.1', checkedAt: '2026-10-22', checks: ['imposto-seletivo'] },
  'iss-lc116': { version: '2026-10-22.1', checkedAt: '2026-10-22', checks: ['iss-lc116'] },
  'monofasico-autopecas': { version: '2026-10-22.2', checkedAt: '2026-10-22', checks: ['monofasico'] },
  'pe-icms-interno': { version: '2026-10-22.1', checkedAt: '2026-10-22', checks: ['pe-icms-interno'] },
  'pe-st-autopecas': { version: '2026-10-19.1', checkedAt: '2026-10-22', checks: ['pe-st-autopecas'] },
  'simples-anexos': { version: '2026-10-22.1', checkedAt: '2026-10-22', checks: ['simples-anexos-ii-a-v'] },
  'simples-comercio': { version: '2026-10-13.1', checkedAt: '2026-10-22', checks: ['simples-anexo-i', 'simples-anexo-xviii'] },
  'st-autopecas-anexo-ii': { version: '2026-10-13.1', checkedAt: '2026-10-22', checks: ['st-anexo-ii'] },
  'st-autopecas-protocolo': { version: '2026-10-13.1', checkedAt: '2026-10-22', checks: ['st-protocolo'] },
  'tipi': { version: '2026-01-30', checkedAt: '2026-10-22', checks: ['tipi'] },
};
