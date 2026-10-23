// Mapa de cobertura do motor tributário (tax-engine.md §4.1 e §8): para cada tributo, o que o pacote responde com fonte e conferência
// e o que ainda não. Existe para que o consumidor trate "não coberto" como FORA_DA_COBERTURA (esperado) e nunca como zero.
// Atualizar junto com qualquer tabela nova; o teste confere que toda tabela citada existe.

export type CoverageStatus = 'COMPLETO' | 'PARCIAL' | 'NENHUM' | 'NAO_POR_OPERACAO';

export interface TaxCoverage {
  tax: string;
  status: CoverageStatus;
  /** Ids das tabelas do pacote que sustentam a resposta. */
  tables: string[];
  /** O que está coberto, em uma frase. */
  covered: string;
  /** O que falta e por quê (fonte inexistente, decisão do contador, regulamentação pendente...). */
  gaps: string[];
}

export const TAX_COVERAGE: TaxCoverage[] = [
  {
    tax: 'SIMPLES',
    status: 'COMPLETO',
    tables: ['simples-comercio', 'simples-anexos'],
    covered: 'Anexos I a V de 2018 a 2033 em diante (LC 123 e LC 214), alíquota efetiva, repartição, teto do ISS, Fator R, 6ª faixa, sublimite e reduções de ST/monofásico/ISS retido.',
    gaps: ['Atividades que combinam anexos (art. 18, §§ 4º, 5º-E e 5º-G), valores fixos do MEI e proporcionalização da RBT12 ficam com quem chama.', 'Monofásico no novo DAS (2027+): sem regra nos textos, a função devolve MONOFASICO_2027_SEM_REGRA.'],
  },
  {
    tax: 'IRPJ_CSLL_PRESUMIDO',
    status: 'COMPLETO',
    tables: ['federal-lucro'],
    covered: 'Presunção por atividade (8%, 1,6%, 16%, 32%, 38,4% e 12% / 32% / 38,4% na CSLL), alíquotas de 15% e 9% e a majoração da LC 224/2025 acima de R$ 5 milhões.',
    gaps: ['O adicional de 10% do IRPJ depende do lucro do período, não da operação.', 'A majoração da LC 224 é exata por operação quando o chamador informa a receita do trimestre; com boolean é o teto. A compensação entre trimestres fica com quem apura.'],
  },
  {
    tax: 'IRPJ_CSLL_REAL',
    status: 'NAO_POR_OPERACAO',
    tables: ['federal-lucro'],
    covered: 'Incidem sobre o lucro apurado, não sobre a operação (tax-engine.md §2).',
    gaps: [],
  },
  {
    tax: 'PIS_COFINS',
    status: 'PARCIAL',
    tables: ['federal-lucro', 'monofasico-autopecas'],
    covered: 'Alíquotas-padrão cumulativa (0,65% e 3%) e não cumulativa (1,65% e 7,6%) até 2026-12-31; monofásico de autopeças (Lei 10.485).',
    gaps: [
      'Demais regimes especiais (combustíveis, medicamentos, bebidas, cosméticos, alíquota zero da cesta, ST de PIS/Cofins): sem tabela.',
      'LC 224/2025, art. 4º: benefícios do demonstrativo de gastos tributários de 2026 pagam 10% da alíquota-padrão desde 2026-04-01. O monofásico de autopeças não consta da planilha do DGT da PLOA 2026 (anexo da LOA final não lido); outras alíquotas zero e isenções não estão modeladas.',
      'CST de PIS/Cofins (tabelas 4.3.10 a 4.3.17 do SPED): sem tabela.',
    ],
  },
  {
    tax: 'IPI',
    status: 'COMPLETO',
    tables: ['tipi'],
    covered: 'Alíquota por NCM de 8 dígitos e ex-tarifário da TIPI atualizada pela Receita (até 2026-01-30), tributado / alíquota zero / não tributado e CST de saída.',
    gaps: ['Se o IPI incide na operação (emitente industrial ou equiparado), suspensão, isenção e imunidade: decisão do enquadramento.', 'Notas Complementares da TIPI e código de enquadramento legal (cEnq): sem tabela.', 'Datas anteriores à última atualização da planilha: sem resposta.'],
  },
  {
    tax: 'ICMS_PROPRIO',
    status: 'PARCIAL',
    tables: ['icms-interestadual', 'pe-icms-interno', 'pe-st-autopecas'],
    covered: 'Alíquota interestadual de todas as UFs (4%, 7%, 12%) e a alíquota interna de PE para autopeças e pneus (18% até 2023, 20,5% desde 2024, conferida com a Lei 15.730).',
    gaps: [
      'Alíquota interna, redução de base, isenção, diferimento e benefícios de 26 UFs e das exceções por produto de PE: dependem do RICMS de cada UF, sem fonte nacional única; exigem curadoria por UF ou fornecedor (tax-engine.md §12).'],
  },
  {
    tax: 'FCP',
    status: 'PARCIAL',
    tables: ['pe-icms-interno'],
    covered: 'PE: autopeça e pneu não pagam FECEP (o adicional de 2 pontos está dentro das alíquotas do Anexo 1 da Lei 15.730, que não os inclui); 3917.32.29 cruza o Anexo 1 e fica DEPENDE.',
    gaps: [
      'PE: o percentual do FECEP dos produtos do Anexo 1 (22,5% a 29%) não está modelado, só a ausência nos segmentos curados.','Percentual por UF e por produto vem de leis estaduais; sem fonte nacional única (PE: FECEP de 2% em produtos listados, ainda sem tabela).'],
  },
  {
    tax: 'ICMS_ST',
    status: 'PARCIAL',
    tables: ['st-autopecas-anexo-ii', 'st-autopecas-protocolo', 'pe-st-autopecas', 'pe-st-pneus'],
    covered: 'Autopeças (Conv. 142/2018, Anexo II; Prot. 41/2008 e 97/2010) e pneus em Pernambuco, MVA original e ajustada.',
    gaps: ['Outros segmentos do Convênio 142 (medicamentos, combustíveis, bebidas, alimentos...) e outras UFs de destino: sem tabela.', 'Pauta e PMPF: sem tabela.'],
  },
  {
    tax: 'DIFAL',
    status: 'NENHUM',
    tables: [],
    covered: '',
    gaps: ['Depende da alíquota interna e da base (única ou dupla) de cada UF de destino (EC 87/2015, LC 190/2022 e leis estaduais).'],
  },
  {
    tax: 'ANTECIPACAO_ICMS',
    status: 'PARCIAL',
    tables: ['pe-antecipacao-simples'],
    covered: 'Pernambuco, optante do Simples, mercadoria sem ST, com regularidade informada.',
    gaps: ['Regime normal em PE, Agreste e todas as outras UFs: sem tabela.'],
  },
  {
    tax: 'ISS',
    status: 'PARCIAL',
    tables: ['iss-lc116', 'iss-recife', 'cnae-lc116'],
    covered: 'Lista de serviços da LC 116 (205 subitens), limites de 2% a 5%, local de incidência do art. 3º, CNAE da oficina para o 14.01 e a redução de 2029 a 2032.',
    gaps: ['Alíquota municipal: só o Recife (subitens fora do item 4, a 5%, com redação de 2003 ainda não conferida contra o texto consolidado); qualquer outro município é MUNICIPIO_NAO_COBERTO e o tenant informa.', 'Retenção na fonte pelo tomador (art. 6º) e regimes municipais: sem tabela.'],
  },
  {
    tax: 'CBS_IBS',
    status: 'PARCIAL',
    tables: ['ibs-cbs-transition', 'ibs-cbs-referencia', 'ibs-cbs-reducoes'],
    covered: 'Calendário de 2026 a 2033 (alíquotas de teste, redução do ICMS e do ISS), reduções de 60% e zero dos Anexos I a XV por NCM/NBS (como candidatos), Simples com CBS/IBS.',
    gaps: [
      'Alíquotas de referência de 2027 em diante: pendentes de resolução do Senado (art. 349); sem elas não há valor.',
      'Regimes específicos (combustíveis, serviços financeiros, planos de saúde, imóveis...), reduções fora dos anexos (profissões intelectuais 30%), Zona Franca, importação.',
      'CST de IBS/CBS e cClassTrib da NF-e: tabela da Nota Técnica, não lida.',
      'Créditos de IBS/CBS (tax-engine.md §5.2.1): sem regra.',
    ],
  },
  {
    tax: 'IMPOSTO_SELETIVO',
    status: 'PARCIAL',
    tables: ['imposto-seletivo'],
    covered: 'Incidência por NCM do Anexo XVII da LC 214 (veículos, aeronaves e embarcações, fumígenos, bebidas, bens minerais) a partir de 2027.',
    gaps: ['Alíquotas são de lei ordinária (arts. 419, 421 e 422) e não estão no pacote: ALIQUOTA_NAO_FIXADA.', 'Concursos de prognósticos e fantasy sport (serviços): sem NCM.'],
  },
  {
    tax: 'RETENCOES_NA_FONTE',
    status: 'NENHUM',
    tables: [],
    covered: '',
    gaps: ['IRRF, CSRF (PIS/Cofins/CSLL), INSS e ISS retido dependem de quem toma o serviço, do regime do prestador e de piso de dispensa (IN RFB 1.234/2012, Leis 10.833/2003 e 8.212/1991): sem tabela.'],
  },
  {
    tax: 'IMPORTACAO',
    status: 'NENHUM',
    tables: [],
    covered: '',
    gaps: ['II (TEC), PIS/Cofins-Importação (2,1% e 9,65% em bens, LC 224 art. 4º, § 3º, IV), ICMS na importação, AFRMM e Siscomex: sem tabela.'],
  },
  {
    tax: 'CFOP_CST_CSOSN',
    status: 'COMPLETO',
    tables: ['cfop', 'cst-csosn'],
    covered: 'CFOP (695 códigos) e CST/CSOSN/CRT do Convênio s/nº 1970.',
    gaps: ['Determinar o CFOP da operação a partir de natureza, UF e finalidade é regra de quem chama (o pacote só descreve cada código).'],
  },
];

/** Cobertura de um tributo; null se o nome não existe no mapa. */
export function taxCoverage(tax: string): TaxCoverage | null {
  return TAX_COVERAGE.find((c) => c.tax === tax) ?? null;
}
