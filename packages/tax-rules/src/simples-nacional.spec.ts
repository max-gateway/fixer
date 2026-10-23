import { describe, expect, it } from 'vitest';
import { SIMPLES_ANEXOS } from '../data/simples-anexos.js';
import { SIMPLES_TAX_KEYS, simplesDas, simplesFatorR, simplesNacional, type SimplesAnnex } from './simples-nacional.js';
import { simplesRate } from './simples.js';

const scaled = (s: string) => BigInt(s.replace('.', ''));
const sumComponents = (c: Record<string, string>) => Object.values(c).reduce((a, v) => a + scaled(v), 0n);

describe('Simples Nacional: dado das tabelas', () => {
  it('cada anexo cobre 2018 em diante sem buracos, com faixas crescentes e repartição de 100%', () => {
    for (const annex of ['II', 'III', 'IV', 'V'] as const) {
      const periods = SIMPLES_ANEXOS.filter((p) => p.annex === annex).sort((a, b) => a.from.localeCompare(b.from));
      expect(periods[0]!.from).toBe('2018-01-01');
      expect(periods.at(-1)!.to).toBeNull();
      periods.slice(1).forEach((p, i) => {
        const prevEnd = new Date(periods[i]!.to! + 'T00:00:00Z');
        prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
        expect(p.from, `${annex}: ${periods[i]!.id} -> ${p.id}`).toBe(prevEnd.toISOString().slice(0, 10));
      });
      for (const p of periods) {
        expect(p.brackets.map((b) => b.bracket)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(p.brackets.at(-1)!.upToCents).toBe(480_000_000n);
        p.brackets.forEach((b, i) => {
          if (i > 0) expect(b.upToCents).toBeGreaterThan(p.brackets[i - 1]!.upToCents);
          expect(Object.values(b.share).reduce((a, v) => a + scaled(v), 0n), `${p.id} faixa ${b.bracket}`).toBe(10_000n);
        });
      }
    }
  });

  // A parcela a deduzir faz a alíquota efetiva ser contínua entre faixas: na fronteira, as duas fórmulas dão o mesmo valor.
  it('a alíquota efetiva é contínua na fronteira das faixas 1 a 5 (a 6ª é descontínua por desenho: ICMS e ISS saem do DAS)', () => {
    for (const p of SIMPLES_ANEXOS) {
      for (let i = 0; i < 4; i++) {
        const lo = p.brackets[i]!;
        const hi = p.brackets[i + 1]!;
        const edge = lo.upToCents;
        const a = edge * scaled(lo.nominalPct) - lo.deductionCents * 10_000n;
        const b = edge * scaled(hi.nominalPct) - hi.deductionCents * 10_000n;
        // diferença de até R$ 0,01 de imposto no ponto de corte, por arredondamento da própria lei
        const diffCents = (a - b) / 10_000n;
        expect(diffCents < 2n && diffCents > -2n, `${p.id} ${lo.bracket}->${hi.bracket}: ${diffCents}`).toBe(true);
      }
    }
  });
});

describe('Simples Nacional: cálculo', () => {
  it('Anexo II, 4ª faixa (R$ 1 milhão): efetiva 8,95%, ICMS 2,8640%, soma fecha na efetiva', () => {
    const r = simplesNacional('II', '1000000.00', '2026-09-01')!;
    expect(r).toMatchObject({ bracket: 4, nominalPct: '11.20', effectivePct: '8.9500' });
    expect(r.components.icms).toBe('2.8640');
    expect(sumComponents(r.components)).toBe(scaled(r.effectivePct));
    expect(r.cppOutsideDas).toBe(false);
  });

  it('Anexo III, 1ª faixa (R$ 100 mil): efetiva = nominal 6% e cada tributo da repartição', () => {
    const r = simplesNacional('III', '100000.00', '2026-09-01')!;
    expect(r.effectivePct).toBe('6.0000');
    expect(r.components).toMatchObject({ irpj: '0.2400', csll: '0.2100', cofins: '0.7692', pis: '0.1668', cpp: '2.6040', iss: '2.0100' });
  });

  it('Anexo III, 5ª faixa: ISS limitado a 5% e o excedente repartido (art. 18, § 1º-B, I)', () => {
    // efetiva = (3.000.000 × 21% − 125.640) ÷ 3.000.000 = 16,812%; ISS sem teto seria 5,632%
    const r = simplesNacional('III', '3000000.00', '2026-09-01')!;
    expect(r.effectivePct).toBe('16.8120');
    expect(r.issCapApplied).toBe(true);
    expect(r.components.iss).toBe('5.0000');
    // (16,812 − 5) × 65,26% = 7,7085…
    expect(Number(r.components.cpp)).toBeCloseTo(7.7085, 3);
    expect(sumComponents(r.components)).toBe(scaled(r.effectivePct));
  });

  it('Anexo III, 5ª faixa com ISS abaixo do teto não aciona a redistribuição', () => {
    // efetiva a R$ 1.800.000,01 = 14,12% a 14,13%... ISS 33,5% = 4,73% < 5%
    const r = simplesNacional('III', '1900000.00', '2026-09-01')!;
    expect(r.bracket).toBe(5);
    expect(r.issCapApplied).toBe(false);
  });

  it('Anexo IV: sem CPP no DAS e teto do ISS na 5ª faixa', () => {
    const r = simplesNacional('IV', '500000.00', '2026-09-01')!;
    expect(r).toMatchObject({ bracket: 3, effectivePct: '7.7160', cppOutsideDas: true });
    expect(r.components.cpp).toBe('0.0000');
    expect(r.components.iss).toBe('3.0864'); // 40% de 7,716
    const cap = simplesNacional('IV', '3500000.00', '2026-09-01')!;
    expect(cap.issCapApplied).toBe(true);
    expect(cap.components.iss).toBe('5.0000');
  });

  it('Anexo V, 2ª faixa (R$ 200 mil): efetiva 15,75%', () => {
    const r = simplesNacional('V', '200000.00', '2026-09-01')!;
    expect(r).toMatchObject({ bracket: 2, effectivePct: '15.7500' });
    expect(r.components.irpj).toBe('3.6225'); // 23% de 15,75
    expect(sumComponents(r.components)).toBe(scaled(r.effectivePct));
  });

  it('6ª faixa: ICMS e ISS fora do DAS e a soma continua fechando', () => {
    for (const annex of ['II', 'III', 'IV', 'V'] as SimplesAnnex[]) {
      const r = simplesNacional(annex, '4000000.00', '2026-09-01')!;
      expect(r.bracket).toBe(6);
      expect(r.components.icms).toBe('0.0000');
      expect(r.components.iss).toBe('0.0000');
      expect(r.stateTaxesOutsideDas).toBe(true);
      expect(r.dasPct).toBe(r.effectivePct);
      expect(sumComponents(r.components)).toBe(scaled(r.effectivePct));
    }
  });

  it('sublimite estadual menor tira ICMS e ISS do DAS mesmo na 5ª faixa', () => {
    const r = simplesNacional('III', '3000000.00', '2026-09-01', { stateSublimitCents: 180_000_000n })!;
    expect(r.stateTaxesOutsideDas).toBe(true);
    expect(r.dasPct).toBe('11.8120'); // 16,812 − ISS 5,000
    expect(simplesNacional('III', '3000000.00', '2026-09-01')!.stateTaxesOutsideDas).toBe(false);
  });

  it('a partir de 2027 o Anexo III troca PIS/Cofins por CBS e IBS', () => {
    const r = simplesNacional('III', '100000.00', '2027-03-01')!;
    expect(r.periodId).toBe('LC214-AnexoXX-2027-2028');
    expect(r.components).toMatchObject({ pis: '0.0000', cofins: '0.0000', cbs: '0.9258', ibs: '0.0102', iss: '2.0100' });
    expect(sumComponents(r.components)).toBe(scaled(r.effectivePct));
  });

  it('o teto do ISS cai conforme o ano (LC 227/2026): 5% em 2027, 4,5% em 2029, 4% em 2030, 3% em 2032', () => {
    const iss = (d: string) => simplesNacional('III', '3000000.00', d)!;
    expect(iss('2027-06-01').components.iss).toBe('5.0000');
    expect(iss('2029-06-01').components.iss).toBe('4.5000');
    expect(iss('2030-06-01').components.iss).toBe('4.0000');
    expect(iss('2032-06-01').components.iss).toBe('3.0000');
    for (const d of ['2027-06-01', '2029-06-01', '2030-06-01', '2031-06-01', '2032-06-01']) {
      expect(sumComponents(iss(d).components), d).toBe(scaled(iss(d).effectivePct));
    }
  });

  it('2033 em diante: ISS extinto, IBS ocupa a parcela', () => {
    const r = simplesNacional('III', '100000.00', '2033-02-01')!;
    expect(r.components.iss).toBe('0.0000');
    expect(r.components.ibs).toBe('2.0100');
  });

  it('o Anexo I (comércio) dá o mesmo resultado que simplesRate, antes e depois da reforma', () => {
    for (const [rbt, d] of [['150000.00', '2026-06-01'], ['900000.00', '2026-06-01'], ['2500000.00', '2026-06-01'], ['4200000.00', '2026-06-01'], ['900000.00', '2027-06-01'], ['900000.00', '2030-06-01']] as const) {
      const a = simplesNacional('I', rbt, d)!;
      const b = simplesRate(rbt, d)!;
      expect(a.effectivePct, `${rbt} ${d}`).toBe(b.effectivePct);
      for (const k of ['irpj', 'csll', 'cofins', 'pis', 'cbs', 'cpp', 'icms', 'ibs'] as const) {
        expect(Math.abs(Number(a.components[k]) - Number(b.components[k])), `${rbt} ${d} ${k}`).toBeLessThanOrEqual(0.0003);
      }
      expect(sumComponents(a.components)).toBe(scaled(a.effectivePct));
    }
  });

  it('em toda faixa de todo anexo e período, a soma dos tributos é a efetiva exata', () => {
    const dates = ['2026-06-01', '2027-06-01', '2029-06-01', '2030-06-01', '2031-06-01', '2032-06-01', '2033-06-01'];
    const rbts = ['100000.00', '180000.00', '180000.01', '300000.00', '360000.01', '500000.00', '720000.01', '1000000.00', '1800000.01', '2500000.00', '3600000.00', '3600000.01', '4800000.00'];
    for (const annex of ['I', 'II', 'III', 'IV', 'V'] as SimplesAnnex[]) {
      for (const d of dates) {
        for (const rbt of rbts) {
          const r = simplesNacional(annex, rbt, d)!;
          expect(sumComponents(r.components), `${annex} ${d} ${rbt}`).toBe(scaled(r.effectivePct));
        }
      }
    }
  });

  it('entradas fora do que a lei cobre devolvem null', () => {
    expect(simplesNacional('III', '4800000.01', '2026-06-01')).toBeNull();
    expect(simplesNacional('III', '0.00', '2026-06-01')).toBeNull();
    expect(simplesNacional('III', 'abc', '2026-06-01')).toBeNull();
    expect(simplesNacional('III', '100000.00', '2017-12-31')).toBeNull();
  });

  it('o Anexo III completo reproduz a declaração real do PGDAS-D usada como referência', () => {
    const r = simplesNacional('III', '403848.46', '2026-09-01')!;
    expect(r).toMatchObject({ bracket: 3, effectivePct: '9.1320' });
    expect(r.components.iss).toBe('2.9679');
  });
});

describe('Fator R', () => {
  it('28% ou mais: Anexo III; abaixo: Anexo V', () => {
    expect(simplesFatorR('280000.00', '1000000.00')).toEqual({ ratioPct: '28.0000', annex: 'III' });
    expect(simplesFatorR('279999.99', '1000000.00')).toMatchObject({ annex: 'V' });
    expect(simplesFatorR('0.00', '1000000.00')).toMatchObject({ ratioPct: '0.0000', annex: 'V' });
    expect(simplesFatorR('100.00', '0.00')).toBeNull();
    expect(simplesFatorR('x', '100.00')).toBeNull();
  });
});

describe('Reduções do DAS (art. 18, §§ 4º-A e 12)', () => {
  const asOf = '2026-06-01';
  it('ST/antecipação tira o ICMS; monofásico tira PIS e Cofins; ISS retido tira o ISS', () => {
    const r = simplesNacional('I', '900000.00', asOf)!;
    const full = Number(r.dasPct);
    const st = simplesDas(r, { icmsAlreadyPaid: true }, asOf);
    expect(Number(st.dasPct)).toBeCloseTo(full - Number(r.components.icms), 4);
    const mono = simplesDas(r, { pisCofinsMonophasic: true }, asOf);
    expect(Number(mono.dasPct)).toBeCloseTo(full - Number(r.components.pis) - Number(r.components.cofins), 4);
    const svc = simplesNacional('III', '403848.46', asOf)!;
    expect(simplesDas(svc, { issWithheld: true }, asOf).dasPct).toBe('6.1641'); // igual à declaração real com ISS retido
  });

  it('não tira ICMS/ISS duas vezes quando o sublimite já os tirou', () => {
    const r = simplesNacional('III', '3000000.00', asOf, { stateSublimitCents: 180_000_000n })!;
    expect(simplesDas(r, { issWithheld: true }, asOf).dasPct).toBe(r.dasPct);
  });

  it('monofásico a partir de 2027 não tem regra nos textos: não inventa número', () => {
    const r = simplesNacional('I', '900000.00', '2027-06-01')!;
    expect(simplesDas(r, { pisCofinsMonophasic: true }, '2027-06-01')).toEqual({ status: 'MONOFASICO_2027_SEM_REGRA', dasPct: null, removed: [] });
  });
});

describe('chaves de tributo', () => {
  it('SIMPLES_TAX_KEYS cobre todo tributo presente na repartição', () => {
    const keys = new Set(Object.keys(SIMPLES_ANEXOS[0]!.brackets[0]!.share));
    expect([...keys].sort()).toEqual([...SIMPLES_TAX_KEYS].sort());
  });
});
