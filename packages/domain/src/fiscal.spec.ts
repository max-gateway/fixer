import { describe, expect, it } from 'vitest';
import {
  partFiscalIssues,
  serviceFiscalIssues,
  settingsFiscalIssues,
  type PartFiscal,
  type ServiceFiscalProfileLike,
  type TenantFiscalLike,
} from './fiscal.js';

const goodPart: PartFiscal = {
  ncm: '87089300',
  cest: '0107500',
  originCode: 0,
  unit: 'UN',
  defaultCfop: '5102',
  csosn: '102',
  cst: null,
  fiscalVerified: true,
};
const fields = (issues: Array<{ field: string }>) => issues.map((i) => i.field).sort();

describe('partFiscalIssues', () => {
  it('peça completa e verificada no Simples não tem pendências', () => {
    expect(partFiscalIssues(goodPart, 'SIMPLES')).toEqual([]);
  });

  it('peça sem nenhum dado fiscal lista tudo o que falta', () => {
    const empty: PartFiscal = { ncm: null, cest: null, originCode: null, unit: null, defaultCfop: null, csosn: null, cst: null, fiscalVerified: false };
    expect(fields(partFiscalIssues(empty, 'SIMPLES'))).toEqual(['csosn', 'defaultCfop', 'fiscalVerified', 'ncm', 'originCode', 'unit']);
  });

  it('valida o formato de cada campo', () => {
    expect(fields(partFiscalIssues({ ...goodPart, ncm: '8708.93.00' }, 'SIMPLES'))).toEqual(['ncm']);
    expect(fields(partFiscalIssues({ ...goodPart, cest: '01.075.00' }, 'SIMPLES'))).toEqual(['cest']);
    expect(fields(partFiscalIssues({ ...goodPart, originCode: 9 }, 'SIMPLES'))).toEqual(['originCode']);
    expect(fields(partFiscalIssues({ ...goodPart, defaultCfop: '1102' }, 'SIMPLES'))).toEqual(['defaultCfop']); // entrada, não venda
    expect(fields(partFiscalIssues({ ...goodPart, csosn: '555' }, 'SIMPLES'))).toEqual(['csosn']);
    expect(fields(partFiscalIssues({ ...goodPart, unit: 'UNIDADEGRANDE' }, 'SIMPLES'))).toEqual(['unit']);
  });

  it('Simples exige CSOSN; os demais regimes exigem CST de 2 dígitos', () => {
    expect(fields(partFiscalIssues({ ...goodPart, csosn: null }, 'SIMPLES'))).toEqual(['csosn']);
    expect(fields(partFiscalIssues({ ...goodPart, csosn: null, cst: '00' }, 'PRESUMIDO'))).toEqual([]);
    expect(fields(partFiscalIssues({ ...goodPart, csosn: '102', cst: null }, 'REAL'))).toEqual(['cst']);
    expect(fields(partFiscalIssues({ ...goodPart, csosn: null, cst: '0' }, 'REAL'))).toEqual(['cst']);
  });

  it('regime desconhecido: pendência no regime, sem exigir CSOSN nem CST', () => {
    expect(fields(partFiscalIssues(goodPart, null))).toEqual(['taxRegime']);
  });

  it('CFOP de ST (5405/6405) exige CEST e, no Simples, CSOSN 500', () => {
    const st = { ...goodPart, defaultCfop: '5405', csosn: '500' };
    expect(partFiscalIssues(st, 'SIMPLES')).toEqual([]);
    expect(fields(partFiscalIssues({ ...st, cest: null }, 'SIMPLES'))).toEqual(['cest']);
    expect(fields(partFiscalIssues({ ...st, csosn: '102' }, 'SIMPLES'))).toEqual(['csosn']);
  });

  it('CSOSN 500 com CFOP de venda normal é inconsistente', () => {
    expect(fields(partFiscalIssues({ ...goodPart, csosn: '500' }, 'SIMPLES'))).toEqual(['csosn']);
  });

  it('cada pendência traz uma mensagem legível', () => {
    for (const i of partFiscalIssues({ ...goodPart, ncm: 'x', fiscalVerified: false }, 'SIMPLES')) {
      expect(i.message.length).toBeGreaterThan(5);
    }
  });
});

const goodProfile: ServiceFiscalProfileLike = { lc116Item: '14.01', nbs: '1.2001.31.00', verified: true };
const goodSettings: TenantFiscalLike = {
  municipalityIbge: '3550308',
  taxRegime: 'SIMPLES',
  issRate: 2.5,
  municipalServiceCode: '14.01',
  hourlyRate: 120,
};

describe('settingsFiscalIssues', () => {
  it('configuração completa não tem pendências', () => {
    expect(settingsFiscalIssues(goodSettings)).toEqual([]);
  });

  it('sem configuração nenhuma, tudo é pendência', () => {
    expect(fields(settingsFiscalIssues(null))).toEqual(['issRate', 'municipalServiceCode', 'municipalityIbge', 'taxRegime']);
  });

  it('valida IBGE do município (7 dígitos) e alíquota de ISS (> 0 e <= 5)', () => {
    expect(fields(settingsFiscalIssues({ ...goodSettings, municipalityIbge: '123' }))).toEqual(['municipalityIbge']);
    expect(fields(settingsFiscalIssues({ ...goodSettings, issRate: 0 }))).toEqual(['issRate']);
    expect(fields(settingsFiscalIssues({ ...goodSettings, issRate: 7 }))).toEqual(['issRate']);
  });

  it('o valor-hora não é exigido para emitir (só para preço por hora)', () => {
    expect(settingsFiscalIssues({ ...goodSettings, hourlyRate: null })).toEqual([]);
  });
});

describe('serviceFiscalIssues', () => {
  it('perfil verificado e configuração completa: sem pendências', () => {
    expect(serviceFiscalIssues(goodProfile)).toEqual([]);
  });

  it('serviço sem perfil fiscal', () => {
    expect(fields(serviceFiscalIssues(null))).toEqual(['fiscalProfile']);
  });

  it('perfil sem NBS ou não verificado', () => {
    expect(fields(serviceFiscalIssues({ ...goodProfile, nbs: null }))).toEqual(['nbs']);
    expect(fields(serviceFiscalIssues({ ...goodProfile, verified: false }))).toEqual(['fiscalProfile.verified']);
  });

  it('formato do item LC 116 e do NBS', () => {
    expect(fields(serviceFiscalIssues({ ...goodProfile, lc116Item: '1401' }))).toEqual(['lc116Item']);
    expect(fields(serviceFiscalIssues({ ...goodProfile, nbs: '120013100' }))).toEqual(['nbs']);
  });
});
