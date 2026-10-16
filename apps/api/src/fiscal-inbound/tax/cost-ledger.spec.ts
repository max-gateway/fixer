import { Prisma } from '@fixer/db';
import { describe, expect, it } from 'vitest';
import { unitCost } from '../matching/cost.js';
import { allocateByValue, computeLedger, type LedgerInvoiceInput, type LedgerItemInput, type Regime } from './cost-ledger.js';
import { cfopProfile, TAX_RULES_VERSION } from './rules.js';

const base: LedgerItemInput = {
  itemNumber: 1,
  quantity: '4',
  totalPrice: '400.00',
  discount: '0',
  freight: '0',
  insurance: '0',
  otherCosts: '0',
  ipi: '0',
  icmsSt: '0',
  cfop: '5102',
  unitFactor: '1',
  tax: null,
};
const item = (o: Partial<LedgerItemInput> = {}): LedgerItemInput => ({ ...base, ...o });
const run = (items: LedgerItemInput[], opts: { invoice?: LedgerInvoiceInput; regime?: Regime | null } = {}) =>
  computeLedger({ invoice: opts.invoice ?? {}, items, regime: opts.regime === undefined ? 'SIMPLES' : opts.regime });
const cost = (l: ReturnType<typeof run>, n = 1) => l.items.get(n)!.landedCost?.toString();
const codes = (l: ReturnType<typeof run>, n = 1) => l.items.get(n)!.components.map((c) => `${c.code}:${c.treatment}`);

describe('livro de custo: Simples Nacional', () => {
  it('(vProd − vDesc + frete + IPI + ICMS-ST + FCP-ST) ÷ quantidade', () => {
    // 400 − 10 + 22 + 12 + 30 + 4 = 458 ; ÷ 4 = 114.5
    const l = run([item({ discount: '10', freight: '22', ipi: '12', icmsSt: '30', tax: { fcpSt: '4', icmsSt: '30' } })]);
    expect(cost(l)).toBe('114.5');
    expect(l.items.get(1)!.totalCost.toString()).toBe('458');
  });

  it('o FCP-ST entra no custo (o custo antigo não o via)', () => {
    const sem = run([item({ icmsSt: '26.40', tax: { icmsSt: '26.40' } })]);
    const com = run([item({ icmsSt: '26.40', tax: { icmsSt: '26.40', fcpSt: '5.60' } })]);
    expect(Number(cost(com)) - Number(cost(sem))).toBeCloseTo(1.4, 4);
  });

  it('divide pela quantidade em unidades de ESTOQUE (quantidade × fator)', () => {
    expect(cost(run([item({ quantity: '2', totalPrice: '92.15', unitFactor: '4' })]))).toBe('11.5188');
  });

  it('quantidade zero não tem custo', () => {
    expect(cost(run([item({ quantity: '0' })]))).toBeUndefined();
  });

  it('comprador do Simples nunca tem crédito: o ICMS próprio é só informativo', () => {
    const l = run([item({ tax: { icmsKind: 'CST', icmsCode: '00', icms: '48' } })]);
    expect(cost(l)).toBe('100');
    expect(codes(l)).toContain('ICMS_PROPRIO:INFO');
    expect(codes(l)).not.toContain('CREDITO_ICMS:CREDIT');
  });

  it('ICMS-ST já retido (CST 60) é informativo e não entra no custo', () => {
    const l = run([item({ tax: { icmsKind: 'CST', icmsCode: '60', stRet: '9.99' } })]);
    expect(cost(l)).toBe('100');
    expect(codes(l)).toContain('ICMS_ST_RETIDO:INFO');
  });

  it('PIS e COFINS do fornecedor são informativos', () => {
    const l = run([item({ tax: { pis: '1.30', cofins: '6' } })]);
    expect(cost(l)).toBe('100');
    expect(codes(l)).toEqual(expect.arrayContaining(['PIS:INFO', 'COFINS:INFO']));
  });

  it('equivale ao unitCost() antigo quando não há FCP-ST, rateio nem crédito', () => {
    const cases = [
      { quantity: '2.0000', totalPrice: '83.80', discount: '3.00', freight: '6.05', insurance: '0', otherCosts: '0', ipi: '1.10', icmsSt: '4.20' },
      { quantity: '12', totalPrice: '342.00', discount: '0', freight: '0', insurance: '1.5', otherCosts: '0.25', ipi: '0', icmsSt: '0' },
      { quantity: '1', totalPrice: '0.1', discount: '0', freight: '0.2', insurance: '0', otherCosts: '0', ipi: '0', icmsSt: '0' },
      { quantity: '3', totalPrice: '1000', discount: '100', freight: '0', insurance: '0', otherCosts: '0', ipi: '50', icmsSt: '75.55' },
    ];
    for (const c of cases) {
      for (const factor of ['1', '4', '0.5']) {
        const ledger = run([item({ ...c, unitFactor: factor })]);
        expect(cost(ledger), JSON.stringify([c, factor])).toBe(unitCost(c, factor)?.toString());
      }
    }
  });
});

describe('livro de custo: rateio do total da nota', () => {
  const total = (o: Record<string, string>): LedgerInvoiceInput => ({ totals: o });

  it('frete só no total: diferença rateada pelo valor dos produtos, marcada como rateada', () => {
    const l = run([item({ itemNumber: 1, totalPrice: '100' }), item({ itemNumber: 2, totalPrice: '300' })], { invoice: total({ vFrete: '20.00' }) });
    expect(l.items.get(1)!.totalCost.toString()).toBe('105');
    expect(l.items.get(2)!.totalCost.toString()).toBe('315');
    expect(l.items.get(1)!.components.find((c) => c.code === 'FRETE')).toMatchObject({ allocated: true, source: 'total/vFrete' });
    expect(l.alerts.map((a) => a.code)).toContain('TOTAIS_DIVERGENTES');
  });

  it('a soma das partes é exata e o resto de centavos vai para o maior item', () => {
    const parts = allocateByValue(new Prisma.Decimal('10'), [
      { key: 1, weight: new Prisma.Decimal('100') },
      { key: 2, weight: new Prisma.Decimal('100') },
      { key: 3, weight: new Prisma.Decimal('100') },
    ]);
    const sum = [...parts.values()].reduce((s, v) => s.plus(v), new Prisma.Decimal(0));
    expect(sum.toString()).toBe('10');
    expect([...parts.values()].map(String).sort()).toEqual(['3.33', '3.33', '3.34']);
  });

  it('desconto só no total abate o custo; despesa já nos itens não é rateada de novo', () => {
    const l = run([item({ itemNumber: 1, totalPrice: '100', freight: '5' }), item({ itemNumber: 2, totalPrice: '100', freight: '5' })], {
      invoice: total({ vFrete: '10.00', vDesc: '20.00' }),
    });
    expect(l.items.get(1)!.totalCost.toString()).toBe('95'); // 100 + 5 − 10
    expect(l.alerts.filter((a) => a.code === 'TOTAIS_DIVERGENTES')).toHaveLength(1);
  });

  it('itens acima do total informado: alerta de divergência, sem rateio negativo', () => {
    const l = run([item({ freight: '30' })], { invoice: total({ vFrete: '10.00' }) });
    expect(cost(l)).toBe('107.5');
    expect(l.alerts.find((a) => a.code === 'TOTAIS_DIVERGENTES')?.severity).toBe('warning');
  });

  it('frete por fora informado à mão é rateado e some o alerta', () => {
    const items = [item({ itemNumber: 1, totalPrice: '100' }), item({ itemNumber: 2, totalPrice: '300' })];
    const sem = run(items, { invoice: { freightMode: 1 } });
    expect(sem.alerts.map((a) => a.code)).toContain('FRETE_POR_FORA');
    const com = run(items, { invoice: { freightMode: 1, extraFreight: '40' } });
    expect(com.alerts.map((a) => a.code)).not.toContain('FRETE_POR_FORA');
    expect(com.items.get(1)!.components.find((c) => c.code === 'FRETE_POR_FORA')).toMatchObject({ source: 'MANUAL', allocated: true });
    expect(com.items.get(1)!.totalCost.toString()).toBe('110');
    expect(com.items.get(2)!.totalCost.toString()).toBe('330');
  });

  it('item fora do total (indTot 0) não recebe rateio e é sinalizado', () => {
    const l = run([item({ itemNumber: 1, totalPrice: '100' }), item({ itemNumber: 2, totalPrice: '100', tax: { indTot: 0 } })], { invoice: total({ vFrete: '10.00' }) });
    expect(l.items.get(1)!.totalCost.toString()).toBe('110');
    expect(l.items.get(2)!.totalCost.toString()).toBe('100');
    expect(l.alerts.find((a) => a.code === 'ITEM_FORA_DO_TOTAL')?.itemNumbers).toEqual([2]);
  });
});

describe('livro de custo: crédito de ICMS por regime', () => {
  const cst00 = { icmsKind: 'CST', icmsCode: '00', icms: '108.00' };

  it('Presumido: CST com direito a crédito abate o custo', () => {
    const l = run([item({ quantity: '3', totalPrice: '900', tax: cst00 })], { regime: 'PRESUMIDO' });
    expect(cost(l)).toBe('264'); // (900 − 108) ÷ 3
    expect(codes(l)).toContain('CREDITO_ICMS:CREDIT');
  });

  it('Real: igual ao Presumido para o ICMS', () => {
    expect(cost(run([item({ quantity: '3', totalPrice: '900', tax: cst00 })], { regime: 'REAL' }))).toBe('264');
  });

  it.each(['40', '41', '50', '51', '60'])('CST %s não dá crédito', (code) => {
    const l = run([item({ tax: { icmsKind: 'CST', icmsCode: code, icms: '10' } })], { regime: 'PRESUMIDO' });
    expect(cost(l)).toBe('100');
  });

  it('emitente do Simples (CSOSN 101): crédito só de vCredICMSSN', () => {
    const l = run([item({ totalPrice: '100', quantity: '4', tax: { icmsKind: 'CSOSN', icmsCode: '101', creditSn: '1.25' } })], { regime: 'PRESUMIDO' });
    expect(cost(l)).toBe('24.6875');
    expect(l.items.get(1)!.components.find((c) => c.code === 'CREDITO_ICMS')?.source).toBe('vCredICMSSN');
  });

  it('CSOSN sem crédito (102) não abate nada', () => {
    expect(cost(run([item({ tax: { icmsKind: 'CSOSN', icmsCode: '102' } })], { regime: 'PRESUMIDO' }))).toBe('100');
  });

  it('item que não é revenda não gera crédito', () => {
    const l = run([item({ cfop: '5910', quantity: '3', totalPrice: '900', tax: cst00 })], { regime: 'PRESUMIDO' });
    expect(cost(l)).toBe('300');
  });

  it('IPI continua custo em qualquer regime (comércio não recupera)', () => {
    expect(cost(run([item({ ipi: '12' })], { regime: 'REAL' }))).toBe('103'); // (400 + 12) ÷ 4
  });

  it('regime nulo: calcula como Simples e avisa', () => {
    const l = run([item({ tax: cst00 })], { regime: null });
    expect(cost(l)).toBe('100');
    expect(l.regime).toBe('SIMPLES');
    expect(l.alerts.map((a) => a.code)).toContain('REGIME_NAO_INFORMADO');
  });
});

describe('livro de custo: alertas', () => {
  it('compra interestadual sem ST: antecipação possível (Simples e Presumido)', () => {
    for (const regime of ['SIMPLES', 'PRESUMIDO'] as const) {
      const l = run([item()], { invoice: { destIndicator: 2 }, regime });
      expect(l.alerts.find((a) => a.code === 'ANTECIPACAO_ICMS_POSSIVEL')?.itemNumbers).toEqual([1]);
    }
  });

  it('não alerta se a ST foi cobrada, já foi retida antes, é interna ou é Lucro Real', () => {
    const inter = { destIndicator: 2 };
    expect(run([item({ icmsSt: '5', tax: { icmsSt: '5' } })], { invoice: inter }).alerts.map((a) => a.code)).not.toContain('ANTECIPACAO_ICMS_POSSIVEL');
    expect(run([item({ tax: { icmsKind: 'CST', icmsCode: '60', stRet: '3' } })], { invoice: inter }).alerts.map((a) => a.code)).not.toContain('ANTECIPACAO_ICMS_POSSIVEL');
    expect(run([item({ tax: { icmsKind: 'CSOSN', icmsCode: '500' } })], { invoice: inter }).alerts.map((a) => a.code)).not.toContain('ANTECIPACAO_ICMS_POSSIVEL');
    expect(run([item()], { invoice: { destIndicator: 1 } }).alerts.map((a) => a.code)).not.toContain('ANTECIPACAO_ICMS_POSSIVEL');
    expect(run([item()], { invoice: inter, regime: 'REAL' }).alerts.map((a) => a.code)).not.toContain('ANTECIPACAO_ICMS_POSSIVEL');
  });

  it('CFOP que não é revenda é listado por item', () => {
    const l = run([item({ itemNumber: 1 }), item({ itemNumber: 2, cfop: '5915' }), item({ itemNumber: 3, cfop: '6910' })]);
    expect(l.alerts.find((a) => a.code === 'NAO_E_COMPRA_REVENDA')?.itemNumbers).toEqual([2, 3]);
  });

  it('nota normal e interna não gera alerta nenhum', () => {
    expect(run([item()], { invoice: { destIndicator: 1, freightMode: 0 } }).alerts).toEqual([]);
  });

  it('a versão das tabelas vai no resultado (reprodutibilidade)', () => {
    expect(run([item()]).rulesVersion).toBe(TAX_RULES_VERSION);
    expect(TAX_RULES_VERSION).toMatch(/simples-comercio@.+\+cfop@/);
  });
});

describe('perfil de CFOP', () => {
  it.each([
    ['5102', 'RESALE'],
    ['6102', 'RESALE'],
    ['6403', 'RESALE'],
    ['5405', 'RESALE'],
    ['5910', 'NOT_RESALE'],
    ['6911', 'NOT_RESALE'],
    ['5915', 'NOT_RESALE'],
    ['5556', 'NOT_RESALE'],
    ['5949', 'NOT_RESALE'],
    ['5999', 'UNKNOWN'],
    ['', 'UNKNOWN'],
    ['12', 'UNKNOWN'],
  ])('%s → %s', (cfop, expected) => {
    expect(cfopProfile(cfop)).toBe(expected);
  });
});
