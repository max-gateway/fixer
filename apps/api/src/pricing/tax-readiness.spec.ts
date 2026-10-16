import { describe, expect, it } from 'vitest';
import { taxReadiness } from './tax-readiness.js';

const none = new Map<string, boolean>();
const profile = (o: Partial<NonNullable<Parameters<typeof taxReadiness>[0]['profile']>> = {}) => ({ rbt12: null, simplesEffectiveRatePct: null, icmsSalePct: null, reviewedAt: null, ...o });
const ids = (r: ReturnType<typeof taxReadiness>) => r.steps.filter((s) => !s.done && !s.optional).map((s) => s.id);

describe('prontidão do imposto', () => {
  it('sem nada configurado: assume Simples e lista tudo o que falta', () => {
    const r = taxReadiness({ regime: null, profile: null, tableReviews: none });
    expect(r).toMatchObject({ regime: 'SIMPLES', regimeInformed: false, supported: true, ready: false });
    expect(ids(r)).toEqual(['regime', 'dados', 'perfil', 'tabela']);
    expect(r.summary).toMatch(/^Imposto estimado\. Falta:/);
  });

  it('Simples pronto: RBT12, perfil e tabela do Simples validados; monofásico é opcional', () => {
    const r = taxReadiness({ regime: 'SIMPLES', profile: profile({ rbt12: 100000, reviewedAt: new Date() }), tableReviews: new Map([['simples-comercio', true]]) });
    expect(r.ready).toBe(true);
    expect(r.steps.find((s) => s.id === 'tabela-monofasico')).toMatchObject({ done: false, optional: true });
    expect(r.summary).toMatch(/^Pronto/);
  });

  it('alíquota informada pelo contador também vale como dado do Simples', () => {
    expect(taxReadiness({ regime: 'SIMPLES', profile: profile({ simplesEffectiveRatePct: 8 }), tableReviews: none }).steps.find((s) => s.id === 'dados')?.done).toBe(true);
  });

  it('tabela validada numa versão anterior não vale', () => {
    const r = taxReadiness({ regime: 'SIMPLES', profile: profile({ rbt12: 1, reviewedAt: new Date() }), tableReviews: new Map([['simples-comercio', false]]) });
    expect(r.ready).toBe(false);
    expect(r.steps.find((s) => s.id === 'tabela')?.detail).toMatch(/versão anterior/);
  });

  it('Lucro Presumido pede o ICMS da venda e a tabela federal', () => {
    const r = taxReadiness({ regime: 'PRESUMIDO', profile: profile({ icmsSalePct: 18, reviewedAt: new Date() }), tableReviews: new Map([['federal-lucro', true]]) });
    expect(r).toMatchObject({ regime: 'PRESUMIDO', ready: true });
    expect(r.requiredTables).toEqual(['federal-lucro', 'monofasico-autopecas']);
    expect(ids(taxReadiness({ regime: 'PRESUMIDO', profile: profile({ rbt12: 5 }), tableReviews: none }))).toEqual(['dados', 'perfil', 'tabela']);
  });

  it('Lucro Real não é suportado: nunca fica pronto', () => {
    const r = taxReadiness({ regime: 'REAL', profile: profile({ reviewedAt: new Date() }), tableReviews: new Map([['federal-lucro', true]]) });
    expect(r).toMatchObject({ supported: false, ready: false, requiredTables: [] });
    expect(r.summary).toMatch(/Lucro Real/);
  });
});
