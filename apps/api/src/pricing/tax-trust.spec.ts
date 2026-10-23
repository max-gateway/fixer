import { SIMPLES_COMERCIO_META, sourceCheck, TABLES } from '@fixer/tax-rules';
import { describe, expect, it } from 'vitest';
import { profileTrust, tableTrust, type TrustProfile } from './tax-trust.js';

const p = (o: Partial<TrustProfile> = {}): TrustProfile => ({ rbt12: null, simplesEffectiveRatePct: null, icmsSalePct: null, icmsSharePct: null, pisSharePct: null, cofinsSharePct: null, reviewedAt: null, ...o });
const prov = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([field, confidence]) => [field, { source: 'X', confidence }]));

describe('confiança do perfil', () => {
  it('aceite do contador vale sempre', () => {
    expect(profileTrust('SIMPLES', p({ rbt12: 1, reviewedAt: new Date() }), prov({}))).toEqual({ basis: 'CONTADOR', pending: [] });
  });

  it('RBT12 oficial (PGDAS-D) dispensa o contador', () => {
    expect(profileTrust('SIMPLES', p({ rbt12: 1 }), prov({ rbt12: 'OFICIAL' }))).toEqual({ basis: 'FONTE_OFICIAL', pending: [] });
  });

  it('RBT12 estimada ou digitada pede o contador', () => {
    expect(profileTrust('SIMPLES', p({ rbt12: 1 }), prov({ rbt12: 'ESTIMADO' }))).toEqual({ basis: null, pending: ['rbt12'] });
    expect(profileTrust('SIMPLES', p({ rbt12: 1 }), prov({}))).toEqual({ basis: null, pending: ['rbt12'] });
  });

  it('percentual digitado por cima da tabela pede o contador mesmo com RBT12 oficial', () => {
    expect(profileTrust('SIMPLES', p({ rbt12: 1, icmsSharePct: 30 }), prov({ rbt12: 'OFICIAL' })).pending).toEqual(['shares']);
    expect(profileTrust('SIMPLES', p({ simplesEffectiveRatePct: 8 }), prov({})).pending).toEqual(['simplesEffectiveRatePct']);
  });

  it('Presumido: ICMS padrão da UF é estimado e pede o contador', () => {
    expect(profileTrust('PRESUMIDO', p({ icmsSalePct: 20.5 }), prov({ icmsSalePct: 'ESTIMADO' }))).toEqual({ basis: null, pending: ['icmsSalePct'] });
  });

  it('sem dado não há o que garantir', () => {
    expect(profileTrust('SIMPLES', p(), prov({}))).toEqual({ basis: null, pending: [] });
    expect(profileTrust('SIMPLES', null, prov({}))).toEqual({ basis: null, pending: [] });
  });
});

describe('confiança das tabelas', () => {
  it('a tabela do Simples está conferida com a lei na versão em uso', () => {
    expect(sourceCheck(SIMPLES_COMERCIO_META)).not.toBeNull();
    expect(tableTrust([]).get('simples-comercio')).toMatchObject({ basis: 'FONTE_OFICIAL', staleReview: false });
  });

  it('aceite do contador na versão em uso vem antes da fonte; versão antiga é marcada', () => {
    const t = TABLES.find((x) => x.id === 'simples-comercio')!;
    expect(tableTrust([{ tableId: t.id, version: t.version }]).get(t.id)?.basis).toBe('CONTADOR');
    expect(tableTrust([{ tableId: t.id, version: 'antiga' }]).get(t.id)).toMatchObject({ basis: 'FONTE_OFICIAL', staleReview: true });
  });
});
