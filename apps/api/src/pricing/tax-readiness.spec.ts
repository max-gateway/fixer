import { describe, expect, it } from 'vitest';
import { taxReadiness, type ReadinessInput } from './tax-readiness.js';
import type { ProfileTrust, TableTrust } from './tax-trust.js';

const profile = (o: Partial<NonNullable<ReadinessInput['profile']>> = {}) => ({ rbt12: null, simplesEffectiveRatePct: null, icmsSalePct: null, ...o });
const none: ProfileTrust = { basis: null, pending: [] };
const byAccountant: ProfileTrust = { basis: 'CONTADOR', pending: [] };
const tables = (entries: [string, Partial<TableTrust>][] = []) => new Map(entries.map(([id, t]) => [id, { basis: null, staleReview: false, checkedAt: null, ...t }]));
const ids = (r: ReturnType<typeof taxReadiness>) => r.steps.filter((s) => !s.done && !s.optional).map((s) => s.id);

describe('prontidão do imposto', () => {
  it('sem nada configurado: assume Simples e lista tudo o que falta', () => {
    const r = taxReadiness({ regime: null, profile: null, profileTrust: none, tables: tables() });
    expect(r).toMatchObject({ regime: 'SIMPLES', regimeInformed: false, supported: true, ready: false });
    expect(ids(r)).toEqual(['regime', 'dados', 'perfil', 'tabela']);
    expect(r.summary).toMatch(/^Imposto estimado\. Falta:/);
  });

  it('Simples pronto com o contador: RBT12, perfil e tabela validados; monofásico é opcional', () => {
    const r = taxReadiness({ regime: 'SIMPLES', profile: profile({ rbt12: 100000 }), profileTrust: byAccountant, tables: tables([['simples-comercio', { basis: 'CONTADOR' }]]) });
    expect(r.ready).toBe(true);
    expect(r.steps.find((s) => s.id === 'tabela-monofasico')).toMatchObject({ done: false, optional: true });
    expect(r.summary).toMatch(/^Pronto/);
  });

  it('Simples pronto sem contador: RBT12 do PGDAS-D e tabelas conferidas com a lei', () => {
    const r = taxReadiness({
      regime: 'SIMPLES',
      profile: profile({ rbt12: 100000 }),
      profileTrust: { basis: 'FONTE_OFICIAL', pending: [] },
      tables: tables([['simples-comercio', { basis: 'FONTE_OFICIAL', checkedAt: '2026-10-19' }], ['monofasico-autopecas', { basis: 'FONTE_OFICIAL', checkedAt: '2026-10-19' }]]),
      origin: { source: 'INTEGRA_PGDASD', confidence: 'OFICIAL', reference: 'PA 2026-09' },
    });
    expect(r.ready).toBe(true);
    expect(r.steps.find((s) => s.id === 'dados')?.detail).toMatch(/PGDAS-D.*PA 2026-09/);
    expect(r.steps.find((s) => s.id === 'perfil')).toMatchObject({ done: true, basis: 'FONTE_OFICIAL' });
    expect(r.steps.find((s) => s.id === 'tabela')?.detail).toMatch(/texto da lei em 19\/10\/2026/);
  });

  it('RBT12 estimada pelo Fixer: dado pronto, conferência pede o contador', () => {
    const r = taxReadiness({
      regime: 'SIMPLES',
      profile: profile({ rbt12: 100000 }),
      profileTrust: { basis: null, pending: ['rbt12'] },
      tables: tables([['simples-comercio', { basis: 'FONTE_OFICIAL', checkedAt: '2026-10-19' }]]),
      origin: { source: 'FIXER_ESTIMATE', confidence: 'ESTIMADO', reference: '10/2025 a 09/2026' },
    });
    expect(ids(r)).toEqual(['perfil']);
    expect(r.steps.find((s) => s.id === 'perfil')).toMatchObject({ needsAccountant: true, detail: expect.stringMatching(/não veio do PGDAS-D/) });
    expect(r.steps.find((s) => s.id === 'dados')?.detail).toMatch(/ordens de serviço/);
  });

  it('alíquota informada pelo contador também vale como dado do Simples', () => {
    expect(taxReadiness({ regime: 'SIMPLES', profile: profile({ simplesEffectiveRatePct: 8 }), profileTrust: none, tables: tables() }).steps.find((s) => s.id === 'dados')?.done).toBe(true);
  });

  it('tabela validada numa versão anterior e sem conferência não vale', () => {
    const r = taxReadiness({ regime: 'SIMPLES', profile: profile({ rbt12: 1 }), profileTrust: byAccountant, tables: tables([['simples-comercio', { staleReview: true }]]) });
    expect(r.ready).toBe(false);
    expect(r.steps.find((s) => s.id === 'tabela')?.detail).toMatch(/versão anterior/);
  });

  it('Lucro Presumido pede o ICMS da venda e a tabela federal', () => {
    const r = taxReadiness({ regime: 'PRESUMIDO', profile: profile({ icmsSalePct: 18 }), profileTrust: byAccountant, tables: tables([['federal-lucro', { basis: 'CONTADOR' }]]) });
    expect(r).toMatchObject({ regime: 'PRESUMIDO', ready: true });
    expect(r.requiredTables).toEqual(['federal-lucro', 'monofasico-autopecas']);
    expect(ids(taxReadiness({ regime: 'PRESUMIDO', profile: profile({ rbt12: 5 }), profileTrust: none, tables: tables() }))).toEqual(['dados', 'perfil', 'tabela']);
  });

  it('Lucro Real não é suportado: nunca fica pronto', () => {
    const r = taxReadiness({ regime: 'REAL', profile: profile(), profileTrust: byAccountant, tables: tables([['federal-lucro', { basis: 'CONTADOR' }]]) });
    expect(r).toMatchObject({ supported: false, ready: false, requiredTables: [] });
    expect(r.summary).toMatch(/Lucro Real/);
  });
});
