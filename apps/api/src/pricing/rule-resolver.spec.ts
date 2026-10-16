import type { Prisma } from '@fixer/db';
import { describe, expect, it } from 'vitest';
import { resolveRule } from './rule-resolver.js';

type Rule = Prisma.PricingRuleGetPayload<object>;
const rule = (id: string, scope: Rule['scope'], scopeKey = ''): Rule =>
  ({ id, scope, scopeKey, method: 'MARGIN', value: 30, taxPctOverride: null, overheadPct: 0, rounding: 'NONE', minMarginPct: 0, maxJumpPct: 25 }) as unknown as Rule;

const ctx = { partId: 'p1', ncm: '84213100', supplierCnpj: '11222333000181' };
const all = [
  rule('def', 'DEFAULT'),
  rule('sup', 'SUPPLIER', '11222333000181'),
  rule('ncm4', 'NCM', '8421'),
  rule('ncm5', 'NCM', '84213'),
  rule('part', 'PART', 'p1'),
];

describe('resolveRule: a mais específica vence', () => {
  it('peça > NCM > fornecedor > padrão', () => {
    expect(resolveRule(all, ctx)).toMatchObject({ scope: 'PART', rule: { id: 'part' } });
    expect(resolveRule(all.filter((r) => r.id !== 'part'), ctx)).toMatchObject({ scope: 'NCM', rule: { id: 'ncm5' } });
    expect(resolveRule(all.filter((r) => r.scope !== 'PART' && r.scope !== 'NCM'), ctx)).toMatchObject({ scope: 'SUPPLIER' });
    expect(resolveRule([rule('def', 'DEFAULT')], ctx)).toMatchObject({ scope: 'DEFAULT' });
  });

  it('entre NCM, o prefixo mais longo que casa', () => {
    const ncms = [rule('a', 'NCM', '84'), rule('b', 'NCM', '8421'), rule('c', 'NCM', '84213100'), rule('x', 'NCM', '85')];
    expect(resolveRule(ncms, ctx)?.rule.id).toBe('c');
    expect(resolveRule(ncms.filter((r) => r.id !== 'c'), ctx)?.rule.id).toBe('b');
    expect(resolveRule(ncms.filter((r) => r.id === 'x'), ctx)).toBeNull();
  });

  it('regra de outra peça, outro fornecedor ou outro NCM não vale', () => {
    expect(resolveRule([rule('p', 'PART', 'p2'), rule('s', 'SUPPLIER', '99999999000199'), rule('n', 'NCM', '27')], ctx)).toBeNull();
  });

  it('NCM com pontuação ou ausente não quebra', () => {
    expect(resolveRule([rule('n', 'NCM', '8421')], { ...ctx, ncm: '8421.31.00' })?.rule.id).toBe('n');
    expect(resolveRule([rule('n', 'NCM', '8421')], { ...ctx, ncm: null })).toBeNull();
  });

  it('CNPJ do fornecedor casa sem diferenciar maiúsculas (CNPJ alfanumérico)', () => {
    expect(resolveRule([rule('s', 'SUPPLIER', '12ABC34501DE35')], { ...ctx, supplierCnpj: '12abc34501de35' })?.rule.id).toBe('s');
  });

  it('sem nenhuma regra, null', () => {
    expect(resolveRule([], ctx)).toBeNull();
  });
});
