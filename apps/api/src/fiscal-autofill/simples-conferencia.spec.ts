import { describe, expect, it } from 'vitest';
import { conferirSimples } from './simples-conferencia.js';

// Valores reais de duas declarações do PGDAS-D (09/2026), lidos pelo serviço `integra-contador`.
const maxEshop = {
  periodoDeclaracao: '202609',
  rbt12Base: '36024.00', // RBT12p: 4 meses de atividade
  atividadesAnexoI: [{ receita: '5055.00', aliquotaDeclaradaPct: '2.6400', icmsSt: true, monofasico: [] }],
};
const oficina = {
  periodoDeclaracao: '202609',
  rbt12Base: '403848.46', // RBT12p: 10 meses de atividade
  atividadesAnexoI: [
    { receita: '21964.35', aliquotaDeclaradaPct: '6.0681', icmsSt: false, monofasico: [] },
    { receita: '39682.27', aliquotaDeclaradaPct: '5.1275', icmsSt: false, monofasico: ['COFINS', 'PIS'] },
  ],
  atividadesAnexoIII: [
    { receita: '5653.73', aliquotaDeclaradaPct: '9.1318', issRetido: false },
    { receita: '6626.11', aliquotaDeclaradaPct: '6.1641', issRetido: true },
  ],
};

describe('conferência da tabela do Simples com a declaração da Receita', () => {
  it('Anexo I com ST de ICMS: a tabela do Fixer reproduz a alíquota da Receita', () => {
    const c = conferirSimples(maxEshop);
    expect(c.status).toBe('CONFERE');
    expect(c.itens[0]).toMatchObject({ declaradaPct: '2.6400', tabelaPct: '2.6400', diferencaPct: '0.0000', confere: true });
  });

  it('receita comum e monofásica na mesma empresa: bate dentro do arredondamento da Receita', () => {
    const c = conferirSimples(oficina);
    expect(c.status).toBe('CONFERE');
    expect(c.itens.filter((i) => i.anexo === 'I').map((i) => [i.tabelaPct, i.diferencaPct])).toEqual([
      ['6.0680', '0.0001'],
      ['5.1274', '0.0001'],
    ]);
  });

  it('serviços do Anexo III, com e sem ISS retido na fonte: a tabela reproduz a Receita', () => {
    const c = conferirSimples(oficina);
    expect(c.itens.filter((i) => i.anexo === 'III').map((i) => [i.tabelaPct, i.declaradaPct, i.confere])).toEqual([
      ['9.1320', '9.1318', true], // declarada derivada de tributos arredondados a centavos
      ['6.1641', '6.1641', true],
    ]);
  });

  it('ISS retido marcado errado em serviço é pego', () => {
    const errado = { ...oficina, atividadesAnexoI: [], atividadesAnexoIII: [{ ...oficina.atividadesAnexoIII[0]!, issRetido: true }] };
    expect(conferirSimples(errado).status).toBe('DIVERGE');
  });

  it('o Anexo III vale na faixa toda: na 5ª faixa a tabela é a da lei e o ISS retido sai com o teto de 5%', () => {
    // RBT12 de R$ 2,5 mi: efetiva (2.500.000 × 21% − 125.640) ÷ 2.500.000 = 15,9744%; o ISS sem teto passaria de 5%, então fica em 5%.
    // A declaração do exemplo é de outra base (403 mil), por isso diverge: antes desta tabela ficava "sem conferência".
    const grande = { ...oficina, rbt12Base: '2500000.00', atividadesAnexoI: [] };
    const c = conferirSimples(grande);
    expect(c.status).toBe('DIVERGE');
    expect(c.itens.map((i) => [i.anexo, i.tabelaPct])).toEqual([
      ['III', '15.9744'],
      ['III', '10.9744'],
    ]);
  });

  it('enquadrar a atividade errado (ST no lugar de monofásica) é pego', () => {
    const errado = { ...oficina, atividadesAnexoI: [oficina.atividadesAnexoI[0]!, { ...oficina.atividadesAnexoI[1]!, icmsSt: true, monofasico: ['COFINS', 'PIS'] }] };
    const c = conferirSimples(errado);
    expect(c.status).toBe('DIVERGE');
    expect(c.itens[1]).toMatchObject({ confere: false, tabelaPct: '3.0946' });
  });

  it('base de RBT12 errada muda a faixa e é pega', () => {
    expect(conferirSimples({ ...oficina, rbt12Base: '150000.00' }).status).toBe('DIVERGE');
  });

  it('sem atividade do Anexo I, sem base ou com período inválido: não há o que comparar', () => {
    expect(conferirSimples({ ...oficina, atividadesAnexoI: [], atividadesAnexoIII: [] }).status).toBe('SEM_COMPARAVEL');
    expect(conferirSimples({ periodoDeclaracao: '202609' }).status).toBe('SEM_COMPARAVEL');
    expect(conferirSimples({ ...oficina, periodoDeclaracao: 'x' }).status).toBe('SEM_COMPARAVEL');
    expect(conferirSimples(null).status).toBe('SEM_COMPARAVEL');
  });
});
