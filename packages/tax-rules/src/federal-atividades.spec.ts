import { describe, expect, it } from 'vitest';
import { PRESUMPTION } from '../data/presuncao.js';
import { pisCofinsStandard, presumidoByActivity, presumidoCommerce } from './federal.js';

describe('Lucro Presumido por atividade (Lei 9.249/1995, arts. 15 e 20)', () => {
  const d = '2026-06-01';

  it('serviços em geral: presunção de 32% em IRPJ e CSLL', () => {
    // IRPJ 15% × 32% = 4,80%; CSLL 9% × 32% = 2,88%; PIS 0,65% e Cofins 3% cumulativos
    expect(presumidoByActivity('SERVICOS', d)).toMatchObject({ irpjPct: '4.8000', csllPct: '2.8800', pisPct: '0.6500', cofinsPct: '3.0000', totalPct: '11.3300' });
  });

  it('comércio e indústria: 8% e 12% (igual ao presumidoCommerce)', () => {
    expect(presumidoByActivity('COMERCIO_INDUSTRIA', d)).toEqual(presumidoCommerce(d));
    expect(presumidoCommerce(d)).toMatchObject({ irpjPct: '1.2000', csllPct: '1.0800' });
  });

  it('revenda de combustível 1,6% e transporte de passageiros 16%; a CSLL fica em 12%', () => {
    expect(presumidoByActivity('COMBUSTIVEL_REVENDA', d)).toMatchObject({ irpjPct: '0.2400', csllPct: '1.0800' });
    expect(presumidoByActivity('TRANSPORTE_PASSAGEIROS', d)).toMatchObject({ irpjPct: '2.4000', csllPct: '1.0800' });
    expect(presumidoByActivity('TRANSPORTE_CARGA', d)).toMatchObject({ irpjPct: '1.2000', csllPct: '1.0800' });
    expect(presumidoByActivity('SERVICOS_HOSPITALARES', d)).toMatchObject({ irpjPct: '1.2000', csllPct: '1.0800' });
  });

  it('Empresa Simples de Crédito: 38,4% nos dois', () => {
    expect(presumidoByActivity('EMPRESA_SIMPLES_CREDITO', d)).toMatchObject({ irpjPct: '5.7600', csllPct: '3.4560' });
  });

  it('acima de R$ 5 milhões a presunção sobe 10% (LC 224/2025): serviços 35,2%', () => {
    // IRPJ 15% × 35,2% = 5,28%; CSLL 9% × 35,2% = 3,168%
    expect(presumidoByActivity('SERVICOS', d, true)).toMatchObject({ irpjPct: '5.2800', csllPct: '3.1680' });
    expect(presumidoByActivity('COMBUSTIVEL_REVENDA', d, true).irpjPct).toBe('0.2640'); // 1,76% × 15%
    // antes de 2026 não há majoração
    expect(presumidoByActivity('SERVICOS', '2025-12-31', true)).toMatchObject({ irpjPct: '4.8000', csllPct: '2.8800' });
  });

  // IN RFB 2.305/2025, art. 15, § 2º e § 3º: o acréscimo só incide sobre o que passa de R$ 1.250.000 no trimestre.
  describe('majoração só sobre o excedente do trimestre', () => {
    const brl = (v: number) => BigInt(Math.round(v * 100));

    it('operação inteira abaixo do limite do trimestre: sem acréscimo', () => {
      expect(presumidoByActivity('SERVICOS', d, { quarterRevenueBeforeCents: brl(1_000_000), operationCents: brl(100_000) })).toMatchObject({ irpjPct: '4.8000', csllPct: '2.8800' });
    });

    it('operação inteira acima do limite: acréscimo cheio (igual a true)', () => {
      const exact = presumidoByActivity('SERVICOS', d, { quarterRevenueBeforeCents: brl(1_300_000), operationCents: brl(100_000) });
      expect(exact).toEqual(presumidoByActivity('SERVICOS', d, true));
    });

    it('operação que cruza o limite: só a parte de cima recebe o acréscimo', () => {
      // antes R$ 1.200.000 + operação R$ 100.000: R$ 50.000 passam do limite (metade da operação).
      // presunção do IRPJ = 32% × (1 + 10% × 50%) = 33,6%; × 15% = 5,04%. CSLL: 33,6% × 9% = 3,024%.
      expect(presumidoByActivity('SERVICOS', d, { quarterRevenueBeforeCents: brl(1_200_000), operationCents: brl(100_000) })).toMatchObject({ irpjPct: '5.0400', csllPct: '3.0240' });
    });

    it('o acréscimo exato nunca passa do teto (true) nem fica abaixo de nenhum', () => {
      const lo = presumidoByActivity('SERVICOS', d, false);
      const hi = presumidoByActivity('SERVICOS', d, true);
      for (const before of [0, 900_000, 1_240_000, 1_249_999, 1_250_000, 5_000_000]) {
        const r = presumidoByActivity('SERVICOS', d, { quarterRevenueBeforeCents: brl(before), operationCents: brl(10_000) });
        expect(Number(r.irpjPct)).toBeGreaterThanOrEqual(Number(lo.irpjPct));
        expect(Number(r.irpjPct)).toBeLessThanOrEqual(Number(hi.irpjPct));
      }
    });

    it('antes de 2026 não há acréscimo, qualquer que seja a receita', () => {
      expect(presumidoByActivity('SERVICOS', '2025-12-31', { quarterRevenueBeforeCents: brl(9_000_000), operationCents: brl(100_000) })).toMatchObject({ irpjPct: '4.8000' });
    });

    it('valores inválidos são recusados', () => {
      expect(() => presumidoByActivity('SERVICOS', d, { quarterRevenueBeforeCents: 0n, operationCents: 0n })).toThrow();
    });
  });

  it('PIS/Cofins somem em 2027 no Presumido', () => {
    expect(presumidoByActivity('SERVICOS', '2027-01-01')).toMatchObject({ pisPct: '0.0000', cofinsPct: '0.0000', pisCofinsExtinct: true });
  });

  it('toda atividade tem fonte e percentuais válidos', () => {
    for (const p of PRESUMPTION) {
      expect(p.source).toMatch(/Lei 9\.249/);
      expect(Number(p.irpjPct)).toBeGreaterThan(0);
      expect(Number(p.csllPct)).toBeGreaterThan(0);
    }
  });
});

describe('PIS e Cofins padrão', () => {
  it('cumulativo 0,65% e 3%; não cumulativo 1,65% e 7,6%; extintos em 2027', () => {
    expect(pisCofinsStandard('CUMULATIVO', '2026-06-01')).toEqual({ pisPct: '0.6500', cofinsPct: '3.0000' });
    expect(pisCofinsStandard('NAO_CUMULATIVO', '2026-06-01')).toEqual({ pisPct: '1.6500', cofinsPct: '7.6000' });
    expect(pisCofinsStandard('CUMULATIVO', '2027-01-01')).toBeNull();
    expect(pisCofinsStandard('NAO_CUMULATIVO', '2027-01-01')).toBeNull();
  });
});
