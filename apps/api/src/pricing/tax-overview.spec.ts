import { describe, expect, it } from 'vitest';
import { buildTaxOverview } from './tax-overview.js';

describe('buildTaxOverview', () => {
  it('Simples: faixa, alíquota efetiva e uso do teto', () => {
    const o = buildTaxOverview({ regime: 'SIMPLES', rbt12: '1000000.00', asOf: '2026-10-22' });
    expect(o.simples?.bracket).toBe(4);
    expect(Number(o.simples?.effectivePct)).toBeGreaterThan(0);
    expect(o.simples?.ceilingUsedPct).toBeCloseTo(20.83, 1);
    expect(o.simples?.nextBracketAtCents).toBe('180000000');
    expect(o.simples?.components.length).toBeGreaterThan(0);
  });

  it('acima do teto: fora do Simples', () => {
    const o = buildTaxOverview({ regime: 'SIMPLES', rbt12: '5000000.00', asOf: '2026-10-22' });
    expect(o.simples?.outsideSimples).toBe(true);
  });

  it('sem RBT12 não há bloco do Simples; Presumido traz os federais', () => {
    expect(buildTaxOverview({ regime: 'SIMPLES', rbt12: null, asOf: '2026-10-22' }).simples).toBeNull();
    expect(buildTaxOverview({ regime: 'PRESUMIDO', rbt12: null, asOf: '2026-10-22' }).presumido?.totalPct).toBeDefined();
  });
});

describe('buildTaxOverview: ISS', () => {
  it('Recife, subitem 14.01 sem alíquota salva: o motor responde 5%', () => {
    const o = buildTaxOverview({ regime: 'SIMPLES', rbt12: null, asOf: '2026-10-22', iss: { ibge: '2611606', item: '14.01', saved: null } });
    expect(o.iss.engine?.status).toBe('OK');
    expect(Number(o.iss.engine?.ratePct)).toBe(5);
  });
  it('outro município: não coberto, sem chute; alíquota salva fora da lei é sinalizada', () => {
    const o = buildTaxOverview({ regime: 'SIMPLES', rbt12: null, asOf: '2026-10-22', iss: { ibge: '3550308', item: '14.01', saved: '7' } });
    expect(o.iss.engine?.status).toBe('MUNICIPIO_NAO_COBERTO');
    expect(o.iss.check).toBe('ACIMA_DO_MAXIMO');
  });
});

describe('buildTaxOverview: serviços separados das peças', () => {
  it('Simples: peças no Anexo I e serviço no Anexo III, com o ISS dentro do DAS', () => {
    const o = buildTaxOverview({ regime: 'SIMPLES', rbt12: '300000.00', asOf: '2026-10-22' });
    expect(o.simples?.components.some((c) => c.key === 'iss')).toBe(false);
    expect(o.services.simples?.annex).toBe('III');
    expect(o.services.simples?.components.some((c) => c.key === 'iss')).toBe(true);
  });
  it('Presumido: serviço usa a presunção de 32%', () => {
    const o = buildTaxOverview({ regime: 'PRESUMIDO', rbt12: null, asOf: '2026-10-22' });
    expect(Number(o.services.presumido?.irpjPct)).toBeGreaterThan(Number(o.presumido?.irpjPct));
  });
});
