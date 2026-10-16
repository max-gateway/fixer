// Regras tributárias usadas pelo livro de custo (docs/specs/pricing.md §5.5). As tabelas moram em `packages/tax-rules`
// (docs/specs/tax-rules.md), com fonte, vigência e versão; este arquivo só as reexporta para o código do módulo fiscal.
// Nada aqui é parecer tributário: o contador da oficina precisa validar as tabelas (spec §12, §14).
import { TAX_RULES_PACKAGE_VERSION } from '@fixer/tax-rules';

export { cfopProfile, icmsCreditAllowed, isStPaidBefore, type CfopProfile } from '@fixer/tax-rules';

/** Versão das tabelas de regra; vai no snapshot de cada custo calculado. */
export const TAX_RULES_VERSION = TAX_RULES_PACKAGE_VERSION;
