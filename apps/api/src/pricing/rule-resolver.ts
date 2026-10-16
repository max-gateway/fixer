import type { Prisma } from '@fixer/db';

type Rule = Prisma.PricingRuleGetPayload<object>;

export interface ResolvedRule {
  rule: Rule;
  scope: 'PART' | 'NCM' | 'SUPPLIER' | 'DEFAULT';
}

/**
 * Qual regra vale para um item (docs/specs/pricing.md §4.1): a mais específica vence.
 * Peça > NCM (o prefixo mais longo que casa com o NCM do item) > fornecedor > padrão. Sem nenhuma, null.
 */
export function resolveRule(rules: readonly Rule[], ctx: { partId: string; ncm: string | null; supplierCnpj: string }): ResolvedRule | null {
  const byPart = rules.find((r) => r.scope === 'PART' && r.scopeKey === ctx.partId);
  if (byPart) return { rule: byPart, scope: 'PART' };

  const ncm = (ctx.ncm ?? '').replace(/\D/g, '');
  const byNcm = rules
    .filter((r) => r.scope === 'NCM' && r.scopeKey !== '' && ncm.startsWith(r.scopeKey))
    .sort((a, b) => b.scopeKey.length - a.scopeKey.length)[0];
  if (byNcm) return { rule: byNcm, scope: 'NCM' };

  const bySupplier = rules.find((r) => r.scope === 'SUPPLIER' && r.scopeKey === ctx.supplierCnpj.toUpperCase());
  if (bySupplier) return { rule: bySupplier, scope: 'SUPPLIER' };

  const def = rules.find((r) => r.scope === 'DEFAULT');
  return def ? { rule: def, scope: 'DEFAULT' } : null;
}
