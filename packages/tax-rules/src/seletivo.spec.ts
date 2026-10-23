import { describe, expect, it } from 'vitest';
import { SELETIVO } from '../data/imposto-seletivo.js';
import { impostoSeletivo } from './seletivo.js';

const d = '2027-03-01';

describe('Imposto Seletivo (LC 214, Anexo XVII)', () => {
  it('automóvel (8703) incide; a alíquota é de lei ordinária e não vem inventada', () => {
    expect(impostoSeletivo('87032100', d)).toMatchObject({ status: 'INCIDE', category: 'VEICULOS', rateStatus: 'ALIQUOTA_NAO_FIXADA' });
  });

  it('veículo de carga das posições 8704.xx depende de ser caminhão', () => {
    expect(impostoSeletivo('87042190', d)).toMatchObject({ status: 'DEPENDE', category: 'VEICULOS', condition: 'exceto os caminhões' });
  });

  it('autopeça (8708) e filtro (8421) não estão no anexo', () => {
    expect(impostoSeletivo('87081000', d).status).toBe('NAO_INCIDE');
    expect(impostoSeletivo('84212300', d).status).toBe('NAO_INCIDE');
  });

  it('cigarro (2402) combina alíquota específica; bebida açucarada só o código 2202.10.00', () => {
    expect(impostoSeletivo('24022000', d)).toMatchObject({ status: 'INCIDE', category: 'FUMIGENOS', specificRate: true });
    expect(impostoSeletivo('22021000', d)).toMatchObject({ category: 'BEBIDAS_ACUCARADAS' });
    expect(impostoSeletivo('22029900', d).status).toBe('NAO_INCIDE');
  });

  it('aeronaves 8802 menos 8802.60.00; embarcações 8903', () => {
    expect(impostoSeletivo('88021100', d).status).toBe('INCIDE');
    expect(impostoSeletivo('88026000', d).status).toBe('NAO_INCIDE');
    expect(impostoSeletivo('89031000', d).category).toBe('AERONAVES_EMBARCACOES');
  });

  it('bens minerais: minério de ferro, petróleo bruto, gás natural', () => {
    expect(impostoSeletivo('26011100', d).category).toBe('BENS_MINERAIS');
    expect(impostoSeletivo('27090010', d).category).toBe('BENS_MINERAIS');
    expect(impostoSeletivo('27111100', d).category).toBe('BENS_MINERAIS');
    expect(impostoSeletivo('27090090', d).status).toBe('NAO_INCIDE');
  });

  it('antes de 2027 não vigora; NCM curta é inválida', () => {
    expect(impostoSeletivo('87032100', '2026-12-31').status).toBe('ANTES_DA_VIGENCIA');
    expect(impostoSeletivo('8703', d).status).toBe('NCM_INVALIDO');
  });

  it('toda entrada tem prefixo numérico e categoria', () => {
    for (const e of SELETIVO) expect(e.ncmPrefix).toMatch(/^\d{4,8}$/);
  });
});
