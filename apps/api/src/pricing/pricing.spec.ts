import { Prisma } from '@fixer/db';
import { describe, expect, it } from 'vitest';
import {
  blockingFlags,
  evaluatePrice,
  marginFromPrice,
  priceFromMargin,
  PricingError,
  roundPrice,
  suggestPrice,
  type EvaluateInput,
  type PriceParams,
} from './pricing.js';
import { requiredTables, saleTax, type SaleTaxFlags, type TaxProfileInput } from './sale-tax.js';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const params = (o: Partial<PriceParams> = {}): PriceParams => ({ method: 'MARGIN', value: 40, taxPct: 0, overheadPct: 0, rounding: 'NONE', ...o });

describe('arredondamento (sempre para cima)', () => {
  it.each([
    ['CENTS_90', '79.31', '79.9'],
    ['CENTS_90', '79.90', '79.9'],
    ['CENTS_90', '79.91', '80.9'],
    ['CENTS_90', '0.50', '0.9'],
    ['CENTS_90', '100', '100.9'],
    ['CENTS_00', '79.01', '80'],
    ['CENTS_00', '80', '80'],
    ['MULTIPLE_5', '81', '85'],
    ['MULTIPLE_5', '85', '85'],
    ['MULTIPLE_10', '81', '90'],
    ['NONE', '166.6667', '166.67'],
    ['NONE', '166.60', '166.6'],
  ] as const)('%s %s → %s', (mode, price, expected) => {
    expect(roundPrice(price, mode).toString()).toBe(expected);
  });
});

describe('suggestPrice', () => {
  it('margem 40% sobre a venda: custo 100 → 166,67', () => {
    expect(suggestPrice(100, params()).price.toString()).toBe('166.67');
  });

  it('markup 40% sobre o custo: custo 100 → 140', () => {
    expect(suggestPrice(100, params({ method: 'MARKUP' })).price.toString()).toBe('140');
  });

  it('imposto e despesa entram no divisor: margem 30 + imposto 6 + despesa 4 → ÷ 0,60', () => {
    expect(suggestPrice(100, params({ value: 30, taxPct: 6, overheadPct: 4 })).price.toString()).toBe('166.67');
  });

  it('markup com imposto: custo × (1 + m) ÷ (1 − imposto)', () => {
    // 100 × 1,4 ÷ 0,94 = 148,9362 → 148,94
    expect(suggestPrice(100, params({ method: 'MARKUP', taxPct: 6 })).price.toString()).toBe('148.94');
  });

  it('a margem reportada é a líquida, depois do arredondamento', () => {
    const r = suggestPrice(100, params({ rounding: 'CENTS_90' }));
    expect(r.price.toString()).toBe('166.9');
    expect(r.marginPct.toDecimalPlaces(2).toString()).toBe('40.08'); // (166,90 − 100) ÷ 166,90
    expect(r.markupPct.toDecimalPlaces(2).toString()).toBe('66.9');
  });

  it('margem líquida desconta imposto e despesa do preço', () => {
    // preço 166,67: sobra 90% = 150,003; − custo 100 = 50,003 ; ÷ 166,67 ≈ 30%
    expect(marginFromPrice(100, '166.67', 6, 4).toDecimalPlaces(2).toString()).toBe('30');
  });

  it('percentuais que somam 100% ou mais são recusados (sem divisão por zero)', () => {
    expect(() => suggestPrice(100, params({ value: 90, taxPct: 10 }))).toThrow(PricingError);
    expect(() => suggestPrice(100, params({ value: 60, taxPct: 30, overheadPct: 20 }))).toThrow(/100%/);
    expect(() => suggestPrice(100, params({ method: 'MARKUP', taxPct: 60, overheadPct: 40 }))).toThrow(PricingError);
  });

  it('custo zero ou negativo e percentual negativo são recusados', () => {
    expect(() => suggestPrice(0, params())).toThrow(PricingError);
    expect(() => suggestPrice(-1, params())).toThrow(PricingError);
    expect(() => suggestPrice(100, params({ value: -5 }))).toThrow(PricingError);
  });

  it('ida e volta: priceFromMargin(marginFromPrice(p)) ≈ p', () => {
    const margin = marginFromPrice(100, '166.67', 6, 4);
    expect(priceFromMargin(100, margin, 6, 4, 'NONE').toString()).toBe('166.67');
  });

  it('preço nunca fica abaixo do calculado, em nenhum arredondamento', () => {
    for (const rounding of ['NONE', 'CENTS_90', 'CENTS_00', 'MULTIPLE_5', 'MULTIPLE_10'] as const) {
      for (const cost of [3.17, 12.4, 38.12, 91.07, 540]) {
        const raw = D(cost).div(D(1).minus(D(0.35)));
        expect(suggestPrice(cost, params({ value: 35, rounding })).price.gte(raw)).toBe(true);
      }
    }
  });
});

describe('guardas', () => {
  const base = (o: Partial<EvaluateInput> = {}): EvaluateInput => ({
    cost: D(100),
    proposed: D('166.9'),
    currentPrice: D(160),
    previousCost: D(98),
    taxPct: D(0),
    overheadPct: D(0),
    minMarginPct: D(20),
    maxJumpPct: D(25),
    taxConfirmed: true,
    requireTaxConfirmation: false,
    ...o,
  });

  it('preço normal não tem flag', () => {
    expect(evaluatePrice(base())).toEqual([]);
  });

  it('com estrutura (perfil de custos): abaixo do equilíbrio pede ciência; abaixo do mínimo continua bloqueando', () => {
    // custo 100, imposto 6, despesas de venda 4, estrutura 15: mínimo 111,11; equilíbrio 133,33
    const at = (p: number) => evaluatePrice(base({ proposed: D(p), taxPct: D(6), overheadPct: D(4), fixedPct: D(15), minMarginPct: D(0), currentPrice: null }));
    expect(at(120)).toEqual(['BELOW_BREAK_EVEN']);
    expect(blockingFlags(at(120), false, false)).toEqual(['BELOW_BREAK_EVEN']);
    expect(blockingFlags(at(120), true, false)).toEqual([]); // "estou ciente" libera
    expect(at(110)).toContain('BELOW_COST_AFTER_TAX');
    expect(at(110)).not.toContain('BELOW_BREAK_EVEN');
    expect(at(140)).toEqual([]);
    // a margem mínima passa a descontar a estrutura: 140 tem margem líquida de 3,57%
    expect(evaluatePrice(base({ proposed: D(140), taxPct: D(6), overheadPct: D(4), fixedPct: D(15), minMarginPct: D(5), currentPrice: null }))).toEqual(['BELOW_MIN_MARGIN']);
  });

  it('abaixo do custo bloqueia, mesmo com ciência', () => {
    const f = evaluatePrice(base({ proposed: D(90) }));
    expect(f).toContain('BELOW_COST');
    expect(blockingFlags(f, true, false)).toContain('BELOW_COST');
  });

  it('acima do custo mas abaixo dele depois do imposto: bloqueia também', () => {
    const f = evaluatePrice(base({ proposed: D(104), taxPct: D(10), minMarginPct: D(0) }));
    expect(f).toContain('BELOW_COST_AFTER_TAX');
    expect(f).not.toContain('BELOW_COST');
    expect(blockingFlags(f, true, false)).toContain('BELOW_COST_AFTER_TAX');
  });

  it('margem abaixo do mínimo e salto grande pedem ciência; com ela passam', () => {
    const f = evaluatePrice(base({ proposed: D(110), currentPrice: D(200) }));
    expect(f).toEqual(expect.arrayContaining(['BELOW_MIN_MARGIN', 'BIG_JUMP', 'PRICE_DOWN']));
    expect(blockingFlags(f, false, false)).toEqual(expect.arrayContaining(['BELOW_MIN_MARGIN', 'BIG_JUMP']));
    expect(blockingFlags(f, true, false)).toEqual([]);
  });

  it('peça sem preço atual (nova): sem salto nem queda', () => {
    const f = evaluatePrice(base({ currentPrice: null }));
    expect(f).not.toContain('BIG_JUMP');
    const zero = evaluatePrice(base({ currentPrice: D(0) }));
    expect(zero).not.toContain('BIG_JUMP');
  });

  it('salto de custo é só aviso (não bloqueia nem pede ciência)', () => {
    const f = evaluatePrice(base({ previousCost: D(70) }));
    expect(f).toContain('COST_SPIKE');
    expect(blockingFlags(f, false, false)).toEqual([]);
  });

  it('imposto não confirmado só trava quando a oficina exige confirmação', () => {
    const f = evaluatePrice(base({ taxConfirmed: false, requireTaxConfirmation: true }));
    expect(f).toContain('TAX_UNCONFIRMED');
    expect(blockingFlags(f, false, true)).toContain('TAX_UNCONFIRMED');
    expect(blockingFlags(f, true, true)).toEqual([]);
    expect(evaluatePrice(base({ taxConfirmed: false }))).not.toContain('TAX_UNCONFIRMED');
  });
});

describe('imposto sobre a venda (Simples, percentuais do contador)', () => {
  // Números hipotéticos de teste: alíquota efetiva 10%, sendo 30% dela ICMS, 5% PIS e 20% COFINS.
  const profile = (o: Partial<TaxProfileInput> = {}): TaxProfileInput => ({
    simplesEffectiveRatePct: 10,
    icmsSharePct: 30,
    pisSharePct: 5,
    cofinsSharePct: 20,
    reviewed: true,
    ...o,
  });
  const flags = (o: Partial<SaleTaxFlags> = {}): SaleTaxFlags => ({ icmsStDone: false, monofasico: false, confirmed: true, ...o });
  const calc = (f: Partial<SaleTaxFlags> = {}, p: TaxProfileInput | null = profile(), regime: 'SIMPLES' | 'PRESUMIDO' | 'REAL' | null = 'SIMPLES') =>
    saleTax({ regime, profile: p, flags: flags(f), override: null, asOf: '2026-10-13', tablesReviewed: true });

  it('peça comum: alíquota efetiva cheia', () => {
    expect(calc().pct?.toString()).toBe('10');
  });

  it('ICMS já recolhido por ST: tira a parcela do ICMS', () => {
    const t = calc({ icmsStDone: true });
    expect(t.pct?.toString()).toBe('7');
    expect(t.components.find((c) => c.code === 'ICMS')).toMatchObject({ pct: '0', reason: expect.stringContaining('substituição tributária') });
  });

  it('monofásico: tira PIS e COFINS', () => {
    expect(calc({ monofasico: true }).pct?.toString()).toBe('7.5');
  });

  it('ST e monofásico juntos: sobra só o resto do Simples', () => {
    expect(calc({ icmsStDone: true, monofasico: true }).pct?.toString()).toBe('4.5');
  });

  it('confirmado só com enquadramento confirmado E perfil revisado pelo contador', () => {
    expect(calc().confidence).toBe('CONFIRMADO');
    expect(calc({ confirmed: false }).confidence).toBe('ESTIMADO');
    expect(calc({}, profile({ reviewed: false })).confidence).toBe('ESTIMADO');
  });

  it('sem alíquota informada não inventa: sem percentual', () => {
    expect(calc({}, null)).toMatchObject({ pct: null, unavailable: 'SEM_ALIQUOTA' });
    expect(calc({}, profile({ simplesEffectiveRatePct: null }))).toMatchObject({ pct: null, unavailable: 'SEM_ALIQUOTA' });
  });

  it('precisa tirar uma parcela mas a repartição não foi informada: não chuta', () => {
    expect(calc({ icmsStDone: true }, profile({ icmsSharePct: null }))).toMatchObject({ pct: null, unavailable: 'REPARTICAO_FALTANDO' });
    expect(calc({ monofasico: true }, profile({ cofinsSharePct: null }))).toMatchObject({ pct: null, unavailable: 'REPARTICAO_FALTANDO' });
    // sem ST nem monofásico a repartição não faz falta
    expect(calc({}, profile({ icmsSharePct: null, pisSharePct: null, cofinsSharePct: null })).pct?.toString()).toBe('10');
  });

  it('regime fora do Simples ainda não é calculado; regime nulo conta como Simples', () => {
    expect(calc({}, profile(), 'PRESUMIDO')).toMatchObject({ pct: null, unavailable: 'SEM_ALIQUOTA' }); // falta o ICMS da venda
    expect(calc({}, profile(), 'REAL').unavailable).toBe('REGIME_NAO_SUPORTADO');
    expect(calc({}, profile(), null).pct?.toString()).toBe('10');
  });

  it('percentual definido pela oficina vale em qualquer regime e é rotulado', () => {
    const t = saleTax({ regime: 'REAL', profile: null, flags: flags(), override: 8 });
    expect(t).toMatchObject({ confidence: 'DEFINIDO', unavailable: null });
    expect(t.pct?.toString()).toBe('8');
  });
});

describe('imposto sobre a venda pela RBT12 (Anexo I, packages/tax-rules)', () => {
  const base: TaxProfileInput = { simplesEffectiveRatePct: null, icmsSharePct: null, pisSharePct: null, cofinsSharePct: null, rbt12: 360000, reviewed: true };
  const flags = (o: Partial<SaleTaxFlags> = {}): SaleTaxFlags => ({ icmsStDone: false, monofasico: false, confirmed: true, ...o });
  const calc = (p: Partial<TaxProfileInput>, f: Partial<SaleTaxFlags> = {}, asOf = '2026-10-13') =>
    saleTax({ regime: 'SIMPLES', profile: { ...base, ...p }, flags: flags(f), override: null, asOf, tablesReviewed: true });

  it('só com a RBT12 a alíquota efetiva vem da tabela (2ª faixa no teto: 5,65%)', () => {
    expect(calc({}).pct?.toString()).toBe('5.65');
  });

  it('ST tira a parcela de ICMS da repartição do Anexo I (34% de 5,65%)', () => {
    const t = calc({}, { icmsStDone: true });
    expect(t.pct?.toFixed(4)).toBe('3.7290');
    expect(t.components.find((c) => c.code === 'ICMS')?.pct).toBe('0');
  });

  it('monofásico tira PIS e Cofins pela repartição da tabela', () => {
    expect(calc({}, { monofasico: true }).pct?.toFixed(4)).toBe('4.7743'); // 5,65 − 5,65 × (2,76% + 12,74%)
  });

  it('percentual informado pelo contador vale mais que a tabela', () => {
    expect(calc({ simplesEffectiveRatePct: 10 }).pct?.toString()).toBe('10');
  });

  it('com alíquota do contador e sem repartição, não usa a repartição da tabela', () => {
    expect(calc({ simplesEffectiveRatePct: 10 }, { icmsStDone: true })).toMatchObject({ pct: null, unavailable: 'REPARTICAO_FALTANDO' });
  });

  it('RBT12 acima do teto do Simples: indisponível', () => {
    expect(calc({ rbt12: 5_000_000 })).toMatchObject({ pct: null, unavailable: 'RBT12_FORA_DO_SIMPLES' });
  });

  it('RBT12 acima do sublimite de R$ 3,6 milhões: ICMS sai do DAS, indisponível até o contador informar a alíquota', () => {
    expect(calc({ rbt12: 3_600_000.01 })).toMatchObject({ pct: null, unavailable: 'SUBLIMITE_ESTADUAL' });
    expect(calc({ rbt12: 4_800_000 })).toMatchObject({ pct: null, unavailable: 'SUBLIMITE_ESTADUAL' });
    // No próprio limite o ICMS ainda está dentro do DAS.
    expect(calc({ rbt12: 3_600_000 })).toMatchObject({ unavailable: null });
    // A alíquota efetiva do contador vale mais que a tabela e dispensa o bloqueio.
    expect(calc({ rbt12: 4_000_000, simplesEffectiveRatePct: 12 })).toMatchObject({ unavailable: null });
  });

  it('sem RBT12 e sem alíquota: SEM_ALIQUOTA', () => {
    expect(calc({ rbt12: null })).toMatchObject({ pct: null, unavailable: 'SEM_ALIQUOTA' });
  });


  it('2027: o Anexo XVIII troca PIS/Cofins por CBS e IBS e o preço continua calculável', () => {
    const t = calc({}, {}, '2027-03-01');
    expect(t.pct?.toString()).toBe('5.65');
    expect(t.components.map((c) => c.code)).toEqual(['ICMS', 'CBS', 'IBS', 'OUTROS']);
    expect(t.components.find((c) => c.code === 'CBS')?.pct).toBe('0.8661');
    expect(t.components.find((c) => c.code === 'IBS')?.pct).toBe('0.0096');
  });

  it('2027 com ST: sai a parcela de ICMS (34% de 5,65% na 2ª faixa)', () => {
    expect(calc({}, { icmsStDone: true }, '2027-03-01').pct?.toFixed(4)).toBe('3.7290');
  });

  it('monofásico em 2027: a Lei 10.485 foi revogada, sem cálculo', () => {
    expect(calc({}, { monofasico: true }, '2027-01-01')).toMatchObject({ pct: null, unavailable: 'REGRA_FORA_DE_VIGENCIA' });
    expect(calc({}, {}, '2027-01-01').pct).not.toBeNull();
  });
});

describe('imposto sobre a venda no Lucro Presumido (packages/tax-rules)', () => {
  const base: TaxProfileInput = { simplesEffectiveRatePct: null, icmsSharePct: null, pisSharePct: null, cofinsSharePct: null, icmsSalePct: 18, reviewed: true };
  const flags = (o: Partial<SaleTaxFlags> = {}): SaleTaxFlags => ({ icmsStDone: false, monofasico: false, confirmed: true, ...o });
  const calc = (p: Partial<TaxProfileInput> = {}, f: Partial<SaleTaxFlags> = {}, asOf = '2026-10-13') =>
    saleTax({ regime: 'PRESUMIDO', profile: { ...base, ...p }, flags: flags(f), override: null, asOf, tablesReviewed: true });

  it('peça comum: IRPJ 1,2% + CSLL 1,08% + PIS 0,65% + Cofins 3% + ICMS informado', () => {
    const t = calc();
    expect(t.pct?.toFixed(4)).toBe('23.9300');
    expect(t.components.map((c) => c.code)).toEqual(['IRPJ', 'CSLL', 'PIS', 'COFINS', 'ICMS']);
    expect(t.confidence).toBe('CONFIRMADO');
  });

  it('ST já recolhida tira o ICMS e não pede a alíquota; monofásico tira PIS e Cofins', () => {
    expect(calc({ icmsSalePct: null }, { icmsStDone: true }).pct?.toFixed(4)).toBe('5.9300');
    expect(calc({}, { monofasico: true }).pct?.toFixed(4)).toBe('20.2800');
    expect(calc({}, { icmsStDone: true, monofasico: true }).pct?.toFixed(4)).toBe('2.2800');
  });

  it('sem a alíquota de ICMS da venda e sem ST: indisponível', () => {
    expect(calc({ icmsSalePct: null })).toMatchObject({ pct: null, unavailable: 'SEM_ALIQUOTA' });
  });

  it('RBT12 acima de R$ 5 milhões aplica a majoração da presunção (LC 224/2025)', () => {
    expect(calc({ rbt12: 6_000_000 }).pct?.toFixed(4)).toBe('24.1580');
  });

  describe('majoração pela receita do trimestre (IN RFB 2.305/2025, art. 15)', () => {
    const q = (quarterRevenue: number | null, p: Partial<TaxProfileInput> = {}) =>
      saleTax({ regime: 'PRESUMIDO', profile: { ...base, ...p }, flags: flags(), override: null, asOf: '2026-10-13', tablesReviewed: true, quarterRevenue });

    it('trimestre abaixo de R$ 1,25 milhão: sem acréscimo, mesmo com RBT12 enorme', () => {
      expect(q(900_000, { rbt12: 6_000_000 }).pct?.toFixed(4)).toBe('23.9300');
    });

    it('trimestre já acima de R$ 1,25 milhão: a venda nova é excedente e leva o acréscimo', () => {
      expect(q(1_250_000).pct?.toFixed(4)).toBe('24.1580');
      expect(q(3_000_000).pct?.toFixed(4)).toBe('24.1580');
    });

    it('sem a receita do trimestre, vale o teto antigo pela RBT12', () => {
      expect(q(null, { rbt12: 6_000_000 }).pct?.toFixed(4)).toBe('24.1580');
      expect(q(null, { rbt12: 2_000_000 }).pct?.toFixed(4)).toBe('23.9300');
    });
  });

  it('2027: PIS e Cofins acabam e CBS/IBS ainda não têm alíquota de referência', () => {
    expect(calc({}, {}, '2027-01-01')).toMatchObject({ pct: null, unavailable: 'REFORMA_SEM_ALIQUOTA' });
  });

  it('Lucro Real continua sem cálculo', () => {
    expect(saleTax({ regime: 'REAL', profile: base, flags: flags(), override: null, asOf: '2026-10-13' })).toMatchObject({ pct: null, unavailable: 'REGIME_NAO_SUPORTADO' });
  });

  it('percentual definido pela oficina vale em qualquer regime', () => {
    expect(saleTax({ regime: 'PRESUMIDO', profile: null, flags: flags(), override: 8, asOf: '2027-06-01' }).pct?.toString()).toBe('8');
  });
});

describe('o imposto só é CONFIRMADO com as tabelas de regra validadas pelo contador', () => {
  const profile: TaxProfileInput = { simplesEffectiveRatePct: 10, icmsSharePct: 30, pisSharePct: 5, cofinsSharePct: 20, reviewed: true };
  const flags: SaleTaxFlags = { icmsStDone: false, monofasico: false, confirmed: true };
  const run = (tablesReviewed?: boolean, regime: 'SIMPLES' | 'PRESUMIDO' = 'SIMPLES') =>
    saleTax({ regime, profile: { ...profile, icmsSalePct: 18 }, flags, override: null, asOf: '2026-10-13', ...(tablesReviewed === undefined ? {} : { tablesReviewed }) });

  it('perfil e peça confirmados, tabela não: ESTIMADO (padrão seguro quando ninguém informa)', () => {
    expect(run(false).confidence).toBe('ESTIMADO');
    expect(run().confidence).toBe('ESTIMADO');
    expect(run(false, 'PRESUMIDO').confidence).toBe('ESTIMADO');
  });

  it('com a tabela validada: CONFIRMADO, no Simples e no Presumido', () => {
    expect(run(true).confidence).toBe('CONFIRMADO');
    expect(run(true, 'PRESUMIDO').confidence).toBe('CONFIRMADO');
  });

  it('quais tabelas cada caso exige', () => {
    expect(requiredTables('SIMPLES', { monofasico: false })).toEqual(['simples-comercio']);
    expect(requiredTables(null, { monofasico: false })).toEqual(['simples-comercio']);
    expect(requiredTables('SIMPLES', { monofasico: true })).toEqual(['simples-comercio', 'monofasico-autopecas']);
    expect(requiredTables('PRESUMIDO', { monofasico: false })).toEqual(['federal-lucro']);
    expect(requiredTables('REAL', { monofasico: false })).toEqual([]);
  });
});
