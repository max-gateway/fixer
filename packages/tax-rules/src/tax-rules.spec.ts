import { describe, expect, it } from 'vitest';
import {
  CFOP,
  CFOP_NOT_RESALE_NATURES,
  CFOP_RESALE_NATURES,
  CRT,
  CSOSN,
  CST_ICMS,
  IBS_CBS_REDUCED_AUTOPECAS,
  IBS_CBS_TRANSITION,
  MONOFASICO_AUTOPECAS,
  ORIGEM,
  SIMPLES_COMERCIO,
  ST_AUTOPECAS_ANEXO_II,
  TABLES,
  TAX_RULES_PACKAGE_VERSION,
  cfopInfo,
  cfopProfile,
  icmsCreditAllowed,
  interstateRate,
  isStPaidBefore,
  legacyTaxes,
  monofasicoAutopeca,
  parseCents,
  presumidoCommerce,
  referenceRate,
  reducedRateForNcm,
  simplesRate,
  stAutopecaCest,
  stAutopecaItems,
  stProtocolo,
  transitionFor,
} from '../index.js';

describe('Simples Nacional, Anexo I, até 2026', () => {
  const at = '2026-10-13';

  it('cada faixa de cada período tem repartição somando 100%', () => {
    for (const p of SIMPLES_COMERCIO) {
      for (const b of p.brackets) {
        const sum = Object.values(b.share).reduce((a, v) => a + Number(v), 0);
        expect(sum, `${p.id} faixa ${b.bracket}`).toBeCloseTo(100, 2);
      }
    }
  });

  it('os períodos são contíguos de 2018 em diante', () => {
    for (let i = 1; i < SIMPLES_COMERCIO.length; i++) {
      const prev = new Date(`${SIMPLES_COMERCIO[i - 1]!.to}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() + 1);
      expect(prev.toISOString().slice(0, 10)).toBe(SIMPLES_COMERCIO[i]!.from);
    }
    expect(SIMPLES_COMERCIO.at(-1)!.to).toBeNull();
  });

  it('as faixas são crescentes até R$ 4,8 milhões', () => {
    for (const p of SIMPLES_COMERCIO) {
      const limits = p.brackets.map((b) => b.upToCents);
      expect(limits).toEqual([...limits].sort((a, b) => (a < b ? -1 : 1)));
      expect(limits.at(-1)).toBe(480_000_000n);
    }
  });

  it('1ª faixa: a efetiva é a nominal', () => {
    expect(simplesRate('180000.00', at)).toMatchObject({ bracket: 1, effectivePct: '4.0000' });
    expect(simplesRate('50000', at)).toMatchObject({ bracket: 1, effectivePct: '4.0000' });
  });

  it('limite exato pertence à faixa de baixo; um centavo a mais muda de faixa', () => {
    expect(simplesRate('360000.00', at)?.bracket).toBe(2);
    expect(simplesRate('360000.01', at)?.bracket).toBe(3);
    expect(simplesRate('4800000.00', at)?.bracket).toBe(6);
  });

  it('2ª faixa no teto: (360000 × 7,30% − 5.940) ÷ 360000 = 5,65%', () => {
    expect(simplesRate('360000.00', at)?.effectivePct).toBe('5.6500');
  });

  it('5ª faixa no teto: (3.600.000 × 14,30% − 87.300) ÷ 3.600.000 = 11,875%', () => {
    expect(simplesRate('3600000.00', at)?.effectivePct).toBe('11.8750');
  });

  it('repartição legada: ICMS e PIS saem da efetiva (1ª faixa: 34% e 2,76% de 4%)', () => {
    const r = simplesRate('100000.00', at)!;
    expect(r.periodId).toBe('LC123-AnexoI-2018');
    expect(r.components).toMatchObject({ icms: '1.3600', pis: '0.1104', cofins: '0.5096', cbs: '0.0000', ibs: '0.0000' });
  });

  it('6ª faixa não tem ICMS na repartição', () => {
    expect(simplesRate('4000000.00', at)?.components.icms).toBe('0.0000');
  });

  it('fora do Simples ou inválido devolve null', () => {
    expect(simplesRate('4800000.01', at)).toBeNull();
    expect(simplesRate('0', at)).toBeNull();
    expect(simplesRate('-1', at)).toBeNull();
    expect(simplesRate('abc', at)).toBeNull();
    expect(simplesRate('1.234', at)).toBeNull();
    expect(simplesRate('100000', '2017-12-31')).toBeNull();
  });

  it('parseCents', () => {
    expect(parseCents('1234567.89')).toBe(123456789n);
    expect(parseCents('10.5')).toBe(1050n);
    expect(parseCents('10')).toBe(1000n);
  });
});

describe('Simples Nacional, Anexo XVIII da LC 214 (2027 em diante)', () => {
  it('2027: PIS e Cofins saem, entram CBS 15,33% e IBS 0,17% (1ª faixa, efetiva 4%)', () => {
    const r = simplesRate('100000.00', '2027-01-01')!;
    expect(r.periodId).toBe('LC214-AnexoXVIII-2027-2028');
    expect(r.components).toMatchObject({ cbs: '0.6132', ibs: '0.0068', icms: '1.3600', pis: '0.0000', cofins: '0.0000' });
  });

  it('2027 e 2028: nominal da 6ª faixa é 18,90%, e volta a 19,00% em 2029', () => {
    expect(SIMPLES_COMERCIO.find((p) => p.id === 'LC214-AnexoXVIII-2027-2028')!.brackets[5]!.nominalPct).toBe('18.90');
    expect(SIMPLES_COMERCIO.find((p) => p.id === 'LC214-AnexoXVIII-2029')!.brackets[5]!.nominalPct).toBe('19.00');
  });

  it('a parcela de ICMS migra para o IBS até 2033', () => {
    const icms = ['2029-06-01', '2030-06-01', '2031-06-01', '2032-06-01', '2033-06-01'].map((d) => simplesRate('100000.00', d)!.components.icms);
    expect(icms).toEqual(['1.2240', '1.0880', '0.9520', '0.8160', '0.0000']);
    expect(simplesRate('100000.00', '2033-06-01')!.components.ibs).toBe('1.3600');
  });

  it('mudar de período muda a efetiva só pela nominal (faixas 1 a 5 não mudam)', () => {
    expect(simplesRate('360000.00', '2026-12-31')!.effectivePct).toBe(simplesRate('360000.00', '2027-01-01')!.effectivePct);
  });
});

describe('monofásico de autopeças (Lei 10.485/2002)', () => {
  const today = '2026-10-13';

  it('NCM do Anexo I: SIM, inclusive desdobramentos do código-pai', () => {
    expect(monofasicoAutopeca('8507.10.10', today).status).toBe('SIM'); // Cosit 220/2021
    expect(monofasicoAutopeca('85111000', today).status).toBe('SIM');
    expect(monofasicoAutopeca('87089990', today).status).toBe('SIM');
    expect(monofasicoAutopeca('8527.21.00', today).status).toBe('SIM'); // 8527.2
  });

  it('ex-tarifário e Anexo II dependem de confirmação', () => {
    expect(monofasicoAutopeca('40169990', today)).toMatchObject({ status: 'DEPENDE', entry: { kind: 'EX_TARIFARIO' } });
    expect(monofasicoAutopeca('84099100', today).status).toBe('SIM');
    expect(monofasicoAutopeca('84081000', today).status).toBe('NAO');
    expect(monofasicoAutopeca('84089090', today)).toMatchObject({ status: 'DEPENDE', entry: { annex: 'II' } });
  });

  it('vale a entrada mais específica: 8431.41.00 é Anexo I; o resto da 84.31 é Anexo II com condição', () => {
    expect(monofasicoAutopeca('84314100', today)).toMatchObject({ status: 'SIM', entry: { annex: 'I' } });
    expect(monofasicoAutopeca('84313100', today)).toMatchObject({ status: 'DEPENDE', entry: { annex: 'II' } });
  });

  it('pneus e câmaras-de-ar (art. 5º)', () => {
    expect(monofasicoAutopeca('4011.10.00', today)).toMatchObject({ status: 'SIM', entry: { annex: 'ART5' } });
    expect(monofasicoAutopeca('40131000', today).status).toBe('SIM');
  });

  it('NCM de fora e NCM inválido', () => {
    expect(monofasicoAutopeca('39269090', today).status).toBe('NAO');
    expect(monofasicoAutopeca('', today).status).toBe('NCM_INVALIDO');
    expect(monofasicoAutopeca(null, today).status).toBe('NCM_INVALIDO');
    expect(monofasicoAutopeca('85', today).status).toBe('NCM_INVALIDO');
  });

  it('a lei é revogada em 01/01/2027: depois disso a lista não vale', () => {
    expect(monofasicoAutopeca('85111000', '2026-12-31').status).toBe('SIM');
    expect(monofasicoAutopeca('85111000', '2027-01-01').status).toBe('FORA_DE_VIGENCIA');
  });

  it('prefixos são só dígitos e não se repetem', () => {
    const keys = MONOFASICO_AUTOPECAS.map((e) => e.prefix);
    for (const k of keys) expect(k).toMatch(/^\d{4,8}$/);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('todo Anexo II e ex-tarifário carrega a condição do texto legal', () => {
    for (const e of MONOFASICO_AUTOPECAS) if (e.kind !== 'FULL') expect(e.condition).toBeTruthy();
  });
});

describe('transição IBS/CBS', () => {
  it('2026: CBS 0,9% e IBS 0,1%, PIS/Cofins vivos, Simples fora', () => {
    expect(transitionFor('2026-10-13')).toMatchObject({ cbsPct: '0.90', ibsStatePct: '0.10', pisCofinsInForce: true, simplesOptantesCharged: false });
  });

  it('2027-2028: IBS 0,05% + 0,05%, CBS = referência − 0,1 p.p., sem PIS/Cofins', () => {
    expect(transitionFor('2027-01-01')).toMatchObject({ ibsStatePct: '0.05', ibsMunicipalPct: '0.05', cbsPct: null, cbsReferenceMinusPp: '0.1', pisCofinsInForce: false });
  });

  it('2029 a 2032 reduzem o ICMS em 10, 20, 30 e 40%; 2033 extingue', () => {
    expect([2029, 2030, 2031, 2032, 2033].map((y) => transitionFor(`${y}-06-01`)?.icmsReductionPct)).toEqual(['10', '20', '30', '40', '100']);
  });

  it('os períodos cobrem 2026 em diante sem lacuna nem sobreposição', () => {
    for (let i = 1; i < IBS_CBS_TRANSITION.length; i++) {
      const prev = new Date(`${IBS_CBS_TRANSITION[i - 1]!.to}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() + 1);
      expect(prev.toISOString().slice(0, 10)).toBe(IBS_CBS_TRANSITION[i]!.from);
    }
    expect(transitionFor('2025-12-31')).toBeNull();
  });

  it('não inventa alíquota que a lei deixa para ato do Senado', () => {
    expect(transitionFor('2029-01-01')).toMatchObject({ ibsStatePct: null, cbsPct: null });
  });

  it('legacyTaxes: o que sobra do regime antigo', () => {
    expect(legacyTaxes('2026-10-13')).toEqual({ pisCofins: true, icmsRemainingPct: '100' });
    expect(legacyTaxes('2027-03-01')).toEqual({ pisCofins: false, icmsRemainingPct: '100' });
    expect(legacyTaxes('2031-03-01')).toEqual({ pisCofins: false, icmsRemainingPct: '70' });
    expect(legacyTaxes('2033-01-01')).toEqual({ pisCofins: false, icmsRemainingPct: '0' });
  });

  it('o ICMS que resta na transição bate com o que o Anexo XVIII do Simples destina ao ICMS (30,6/34 = 90% em 2029)', () => {
    const icms2029 = Number(simplesRate('100000.00', '2029-06-01')!.components.icms);
    const icms2028 = Number(simplesRate('100000.00', '2028-06-01')!.components.icms);
    expect(icms2029 / icms2028).toBeCloseTo(0.9, 4);
  });
});

describe('reforma: alíquotas de referência e reduções', () => {
  it('as alíquotas de referência de 2027 a 2033 estão pendentes até o Senado fixar', () => {
    for (let y = 2027; y <= 2033; y++) expect(referenceRate(y)).toMatchObject({ status: 'PENDENTE', cbsPct: null, senateDeadline: `${y - 1}-10-31` });
    expect(referenceRate(2026)).toBeNull();
  });

  it('só acessórios para pessoas com deficiência (Anexo V) têm redução entre as autopeças', () => {
    expect(IBS_CBS_REDUCED_AUTOPECAS.length).toBeGreaterThan(0);
    for (const it of IBS_CBS_REDUCED_AUTOPECAS) expect(it).toMatchObject({ annex: 'V', reductionPct: '60' });
    expect(reducedRateForNcm('8708.99.10').length).toBeGreaterThan(0);
    expect(reducedRateForNcm('87089990')).toEqual([]);
    expect(reducedRateForNcm('85111000')).toEqual([]);
  });
});

describe('ST de autopeças (Convênio ICMS 142/2018, Anexo II)', () => {
  it('tem os itens do anexo, sem CEST repetido e sem o item revogado', () => {
    expect(ST_AUTOPECAS_ANEXO_II.length).toBe(131);
    const cests = ST_AUTOPECAS_ANEXO_II.map((i) => i.cest);
    expect(new Set(cests).size).toBe(cests.length);
    expect(cests).not.toContain('01.110.00');
    for (const c of cests) expect(c).toMatch(/^01\.\d{3}\.\d{2}$/);
  });

  it('só traz a redação nova dos itens alterados em 2022 (assentos 9401.20.00 e 9401.99.00)', () => {
    expect(ST_AUTOPECAS_ANEXO_II.find((i) => i.cest === '01.085.00')!.ncm).toEqual(['9401.20.00', '9401.99.00']);
  });

  it('NCM pelo prefixo e CEST direto', () => {
    expect(stAutopecaItems('3815.12.10').map((i) => i.cest)).toContain('01.001.00');
    expect(stAutopecaItems('85071010').map((i) => i.cest)).toContain('01.053.01');
    expect(stAutopecaItems('39269090')).toEqual([]);
    expect(stAutopecaItems('')).toEqual([]);
    expect(stAutopecaCest('01.001.00')?.item).toBe('1.0');
    expect(stAutopecaCest('33.001.00')).toBeNull();
  });

  it('todo item tem NCM, exceto "outras peças" (01.999.00)', () => {
    for (const i of ST_AUTOPECAS_ANEXO_II) if (i.cest !== '01.999.00') expect(i.ncm.length, i.cest).toBeGreaterThan(0);
  });
});

describe('Protocolo ICMS 41/2008 (retenção interestadual)', () => {
  it('destino na lista e CEST comum: abrangido', () => {
    expect(stProtocolo('01.001.00', 'BA', '2026-10-13')).toBe('ABRANGIDO');
    expect(stProtocolo('01.001.00', 'ba', '2026-10-13')).toBe('ABRANGIDO');
  });

  it('SP sai do protocolo em 2026-10-01 e o RS em 2024-11-01', () => {
    expect(stProtocolo('01.001.00', 'SP', '2026-09-30')).toBe('ABRANGIDO');
    expect(stProtocolo('01.001.00', 'SP', '2026-10-01')).toBe('UF_FORA_DO_PROTOCOLO');
    expect(stProtocolo('01.001.00', 'RS', '2024-10-31')).toBe('ABRANGIDO');
    expect(stProtocolo('01.001.00', 'RS', '2024-11-01')).toBe('UF_FORA_DO_PROTOCOLO');
  });

  it('CEST das exceções, CEST fora do anexo e data sem dado', () => {
    expect(stProtocolo('01.999.00', 'BA', '2026-10-13')).toBe('CEST_EXCETUADO');
    expect(stProtocolo('01.062.01', 'BA', '2026-10-13')).toBe('CEST_EXCETUADO');
    expect(stProtocolo('33.001.00', 'BA', '2026-10-13')).toBe('FORA_DO_ANEXO_II');
    expect(stProtocolo('01.001.00', 'BA', '2023-01-31')).toBe('SEM_DADO_NA_DATA');
  });
});

describe('ICMS interestadual (Resoluções do Senado 22/1989 e 13/2012)', () => {
  it('7% do Sul e Sudeste para Norte, Nordeste, Centro-Oeste e ES; 12% no resto', () => {
    expect(interstateRate('SP', 'BA')).toEqual({ pct: '7', kind: 'SUL_SUDESTE_7' });
    expect(interstateRate('SP', 'ES')?.pct).toBe('7');
    expect(interstateRate('RS', 'GO')?.pct).toBe('7');
    expect(interstateRate('ES', 'BA')?.pct).toBe('7');
    expect(interstateRate('SP', 'MG')?.pct).toBe('12');
    expect(interstateRate('ES', 'SP')?.pct).toBe('12');
    expect(interstateRate('BA', 'SP')?.pct).toBe('12');
    expect(interstateRate('PE', 'BA')?.pct).toBe('12');
  });

  it('importado ou com conteúdo de importação acima de 40%: 4%', () => {
    expect(interstateRate('SP', 'BA', true)).toEqual({ pct: '4', kind: 'IMPORTADO_4' });
    expect(interstateRate('BA', 'SP', true)?.pct).toBe('4');
  });

  it('mesma UF e UF inexistente: sem alíquota interestadual', () => {
    expect(interstateRate('SP', 'SP')).toBeNull();
    expect(interstateRate('XX', 'SP')).toBeNull();
  });
});

describe('Lucro Presumido: tributos federais do comércio', () => {
  it('2026: IRPJ 8% × 15% = 1,2% da receita, CSLL 12% × 9% = 1,08%, PIS 0,65% e Cofins 3%', () => {
    expect(presumidoCommerce('2026-10-13')).toEqual({ irpjPct: '1.2000', csllPct: '1.0800', pisPct: '0.6500', cofinsPct: '3.0000', totalPct: '5.9300', pisCofinsExtinct: false });
  });

  it('acima de R$ 5 milhões no ano, a presunção sobe 10% (LC 224/2025): 8,8% e 13,2%', () => {
    expect(presumidoCommerce('2026-10-13', true)).toMatchObject({ irpjPct: '1.3200', csllPct: '1.1880', totalPct: '6.1580' });
  });

  it('a majoração só vale a partir de 2026', () => {
    expect(presumidoCommerce('2025-12-31', true).irpjPct).toBe('1.2000');
  });

  it('em 2027 PIS e Cofins se extinguem', () => {
    expect(presumidoCommerce('2027-01-01')).toMatchObject({ pisPct: '0.0000', cofinsPct: '0.0000', totalPct: '2.2800', pisCofinsExtinct: true });
  });
});

describe('CFOP, CST e CSOSN', () => {
  it('a tabela do Confaz traz os grupos e os códigos de operação', () => {
    expect(CFOP.length).toBeGreaterThan(600);
    expect(new Set(CFOP.map((c) => c.code)).size).toBe(CFOP.length);
    expect(cfopInfo('5.102')?.title).toMatch(/Venda de mercadoria adquirida/);
    expect(cfopInfo('5102')?.code).toBe('5102');
    expect(cfopInfo('5000')).toBeNull(); // grupo, não operação
    expect(cfopInfo('9999')).toBeNull();
  });

  it('as naturezas que o Fixer trata como revenda e não-revenda existem na tabela do Confaz', () => {
    const exists = (nature: string) => ['1', '2', '5', '6', '3', '7'].some((d) => cfopInfo(`${d}${nature}`));
    for (const n of [...CFOP_RESALE_NATURES, ...CFOP_NOT_RESALE_NATURES]) expect(exists(n), n).toBe(true);
  });

  it('classificação de revenda', () => {
    expect(cfopProfile('5102')).toBe('RESALE');
    expect(cfopProfile('6403')).toBe('RESALE');
    expect(cfopProfile('5910')).toBe('NOT_RESALE');
    expect(cfopProfile('6949')).toBe('NOT_RESALE');
    expect(cfopProfile('5929')).toBe('UNKNOWN');
    expect(cfopProfile('')).toBe('UNKNOWN');
  });

  it('CST: Tabela B só com os códigos em vigor (12, 13, 52, 72 e 74 nunca produziram efeito)', () => {
    const codes = CST_ICMS.map((c) => c.code);
    expect(codes).toEqual(['00', '02', '10', '15', '20', '30', '40', '41', '50', '51', '53', '60', '61', '70', '90']);
    for (const bad of ['12', '13', '52', '72', '74']) expect(codes).not.toContain(bad);
    expect(ORIGEM.map((o) => o.code)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    expect(CRT.map((o) => o.code)).toEqual(['1', '2', '3', '4']);
    expect(CSOSN.map((o) => o.code)).toEqual(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']);
  });

  it('crédito e ST já paga', () => {
    expect(icmsCreditAllowed('CST', '00')).toBe(true);
    expect(icmsCreditAllowed('CST', '60')).toBe(false);
    expect(icmsCreditAllowed('CSOSN', '101')).toBe(true);
    expect(icmsCreditAllowed('CSOSN', '102')).toBe(false);
    expect(icmsCreditAllowed(null, null)).toBe(false);
    expect(isStPaidBefore('CST', '60')).toBe(true);
    expect(isStPaidBefore('CSOSN', '500')).toBe(true);
    expect(isStPaidBefore('CST', '10')).toBe(false);
  });
});

describe('metadados', () => {
  it('toda tabela cita fonte oficial, não foi validada por humano e lista o que não cobre', () => {
    for (const t of TABLES) {
      expect(t.sources.length).toBeGreaterThan(0);
      for (const s of t.sources) expect(s.url).toMatch(/^https:\/\/(www\.planalto\.gov\.br|www\.confaz\.fazenda\.gov\.br|www2\.camara\.leg\.br)\//);
      expect(t.validatedBy).toBeNull();
      expect(t.caveats.length).toBeGreaterThan(0);
    }
  });

  it('os ids são únicos e a versão do pacote lista todas as tabelas', () => {
    const ids = TABLES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TABLES) expect(TAX_RULES_PACKAGE_VERSION).toContain(`${t.id}@${t.version}`);
  });
});
