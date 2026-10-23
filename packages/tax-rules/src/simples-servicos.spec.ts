import { describe, expect, it } from 'vitest';
import { SIMPLES_SERVICOS_ANEXO_III } from '../data/simples-servicos.js';
import { simplesServicoRate } from './simples.js';

describe('Simples Nacional, Anexo III (serviços)', () => {
  it('cada faixa reparte 100% da alíquota', () => {
    for (const b of SIMPLES_SERVICOS_ANEXO_III.brackets) {
      const total = Object.values(b.share).reduce((acc, v) => acc + Math.round(Number(v) * 100), 0);
      expect(total, `faixa ${b.bracket}`).toBe(10_000);
    }
  });

  it('1ª faixa: a alíquota efetiva é a nominal', () => {
    expect(simplesServicoRate('100000.00', '2026-09-01')).toMatchObject({ bracket: 1, effectivePct: '6.0000' });
  });

  // Declaração real do PGDAS-D de 2026-09 (RBT12 proporcional de R$ 403.848,46): serviço comum e, com o ISS retido na fonte (fora
  // do DAS), 6,1641%. Os tributos declarados, em R$, sobre a receita de R$ 5.653,73, saem da repartição da 3ª faixa.
  // A "alíquota declarada" 9,1318% vem de tributos arredondados a centavos (516,29 ÷ 5.653,73); a da tabela, 9,1320%, dá 516,30.
  it('3ª faixa reproduz a declaração da Receita, tributo a tributo', () => {
    const r = simplesServicoRate('403848.46', '2026-09-01')!;
    expect(r.bracket).toBe(3);
    expect(r.effectivePct).toBe('9.1320');
    const declared: Record<string, number> = { irpj: 20.65, csll: 18.07, cofins: 70.42, pis: 15.28, cpp: 224.07, iss: 167.8 };
    for (const [k, valor] of Object.entries(declared)) {
      const calc = (Number(r.components[k as keyof typeof r.components]) / 100) * 5653.73;
      expect(Math.abs(calc - valor), k).toBeLessThan(0.02);
    }
    // ISS retido sai do DAS: efetiva − ISS = 9,1320 − 2,9679 = 6,1641, igual ao declarado.
    expect(Number(r.effectivePct) - Number(r.components.iss)).toBeCloseTo(6.1641, 3);
  });

  it('fora do que a tabela cobre devolve null, nunca um número arriscado', () => {
    expect(simplesServicoRate('1800000.01', '2026-09-01')).toBeNull(); // 5ª faixa: ISS limitado a 5%
    expect(simplesServicoRate('4000000.00', '2026-09-01')).toBeNull();
    expect(simplesServicoRate('0.00', '2026-09-01')).toBeNull();
    expect(simplesServicoRate('abc', '2026-09-01')).toBeNull();
    expect(simplesServicoRate('100000.00', '2027-01-01')).toBeNull(); // Anexo XVIII
    expect(simplesServicoRate('100000.00', '2017-12-31')).toBeNull();
  });
});
