import type { TableMeta } from '../src/types.js';

// Tributos federais do Lucro Presumido e do Lucro Real, para revenda de mercadorias (comércio). Transcrito dos textos
// do Planalto lidos em 2026-10-13. Percentuais em %.
//
// PIS e Cofins: a LC 214/2025 (art. 542) revoga a Lei 10.637/2002, a Lei 10.833/2003 e a Lei 9.715/1998 (arts. citados) a
// partir de 2027-01-01; o `effectiveTo` das linhas de PIS/Cofins é 2026-12-31. IRPJ e CSLL seguem.

export interface RateLine {
  id: string;
  tax: 'IRPJ' | 'IRPJ_ADICIONAL' | 'CSLL' | 'PIS' | 'COFINS';
  regime: 'PRESUMIDO' | 'REAL';
  /** Alíquota em %. */
  ratePct: string;
  /** Percentual de presunção sobre a receita bruta (Presumido), em %; null quando a base é o lucro apurado. */
  presumptionPct: string | null;
  /** Início da vigência; null = anterior a 2018 e não verificado (não afeta preços atuais). */
  from: string | null;
  to: string | null;
  source: string;
  note?: string;
}

export const FEDERAL_LUCRO: RateLine[] = [
  { id: 'irpj-presumido', tax: 'IRPJ', regime: 'PRESUMIDO', ratePct: '15.00', presumptionPct: '8.00', from: null, to: null, source: 'Lei 9.249/1995, arts. 3º e 15 (comércio: 8% da receita bruta)' },
  { id: 'irpj-adicional-presumido', tax: 'IRPJ_ADICIONAL', regime: 'PRESUMIDO', ratePct: '10.00', presumptionPct: '8.00', from: null, to: null, source: 'Lei 9.249/1995, art. 3º, § 1º (com a Lei 9.430/1996): sobre a parcela do lucro que exceder R$ 20.000 por mês (R$ 60.000 por trimestre)', note: 'Depende do volume: não é um percentual fixo da receita.' },
  { id: 'csll-presumido', tax: 'CSLL', regime: 'PRESUMIDO', ratePct: '9.00', presumptionPct: '12.00', from: null, to: null, source: 'Lei 9.249/1995, art. 20 (12% da receita bruta) e Lei 7.689/1988, art. 3º, II (9%)' },
  { id: 'pis-cumulativo', tax: 'PIS', regime: 'PRESUMIDO', ratePct: '0.65', presumptionPct: null, from: null, to: '2026-12-31', source: 'Lei 9.715/1998, art. 8º, I (0,65% sobre o faturamento)' },
  { id: 'cofins-cumulativo', tax: 'COFINS', regime: 'PRESUMIDO', ratePct: '3.00', presumptionPct: null, from: null, to: '2026-12-31', source: 'Lei 9.718/1998, art. 8º (3%)' },
  { id: 'irpj-real', tax: 'IRPJ', regime: 'REAL', ratePct: '15.00', presumptionPct: null, from: null, to: null, source: 'Lei 9.249/1995, art. 3º (sobre o lucro real)' },
  { id: 'irpj-adicional-real', tax: 'IRPJ_ADICIONAL', regime: 'REAL', ratePct: '10.00', presumptionPct: null, from: null, to: null, source: 'Lei 9.249/1995, art. 3º, § 1º (com a Lei 9.430/1996): sobre o lucro que exceder R$ 20.000 por mês' },
  { id: 'csll-real', tax: 'CSLL', regime: 'REAL', ratePct: '9.00', presumptionPct: null, from: null, to: null, source: 'Lei 7.689/1988, art. 3º, II (sobre o lucro ajustado)' },
  { id: 'pis-nao-cumulativo', tax: 'PIS', regime: 'REAL', ratePct: '1.65', presumptionPct: null, from: null, to: '2026-12-31', source: 'Lei 10.637/2002, art. 2º (1,65%, com direito a crédito)' },
  { id: 'cofins-nao-cumulativo', tax: 'COFINS', regime: 'REAL', ratePct: '7.60', presumptionPct: null, from: null, to: '2026-12-31', source: 'Lei 10.833/2003, art. 2º (7,6%, com direito a crédito)' },
];

/**
 * LC 224/2025, art. 4º, § 4º, VII e § 5º: a partir de 2026, acréscimo de 10% (relativo) nos percentuais de presunção do
 * Lucro Presumido, só sobre a parcela da receita bruta total que exceder R$ 5.000.000 no ano-calendário
 * (proporcional por período de apuração). Comércio: 8% passa a 8,8% (IRPJ) e 12% a 13,2% (CSLL) nessa parcela.
 */
export const PRESUMIDO_SURCHARGE = {
  from: '2026-01-01',
  to: null as string | null,
  relativeIncreasePct: '10',
  yearlyRevenueThresholdCents: 500_000_000n,
  /** Limite proporcional por trimestre (IN RFB 2.305/2025, art. 15, § 2º, com a IN RFB 2.306/2026): R$ 1.250.000,00. */
  quarterlyRevenueThresholdCents: 125_000_000n,
  source: 'LC 224/2025, art. 4º, § 4º, VII e § 5º; vigência pelo art. 14, III',
};

export const FEDERAL_LUCRO_META: TableMeta = {
  id: 'federal-lucro',
  version: '2026-10-22.4',
  effectiveFrom: '2018-01-01',
  effectiveTo: null,
  sources: [
    { law: 'Lei 9.249/1995 (arts. 3º, 15 e 20)', url: 'https://www.planalto.gov.br/ccivil_03/leis/l9249.htm', retrievedAt: '2026-10-13' },
    { law: 'Lei 7.689/1988 (art. 3º)', url: 'https://www.planalto.gov.br/ccivil_03/leis/l7689.htm', retrievedAt: '2026-10-13' },
    { law: 'Lei 9.718/1998 (art. 8º) e Lei 9.715/1998 (art. 8º)', url: 'https://www.planalto.gov.br/ccivil_03/leis/l9718compilada.htm', retrievedAt: '2026-10-13' },
    { law: 'Lei 10.637/2002 (art. 2º) e Lei 10.833/2003 (art. 2º)', url: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm', retrievedAt: '2026-10-13' },
    { law: 'LC 224/2025 (art. 4º, § 4º, VII, e § 5º)', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp224.htm', retrievedAt: '2026-10-13' },
  ],
  validatedBy: null,
  caveats: [
    'Presunção por atividade em data/presuncao.ts (comércio/indústria 8%, combustível 1,6%, transporte de passageiros 16%, serviços 32%, ESC 38,4%); qual atividade vale para a receita é decisão de quem chama. Receita mista exige segregação (art. 15, § 2º).',
    'O adicional de 10% do IRPJ depende do lucro do período, não do preço de uma peça: o preço usa só o percentual proporcional à receita.',
    'A majoração da LC 224/2025 está sendo questionada no STF (ADI da OAB, março de 2026, segundo fontes secundárias); o texto da lei vale até decisão contrária.',
    'O Lucro Real não tem alíquota "sobre a venda": IRPJ e CSLL incidem sobre o lucro apurado, PIS e Cofins admitem crédito.',
    'Há PIS/Cofins com alíquotas específicas para outras atividades (combustíveis, medicamentos etc.) que não estão aqui.',
    'LC 224/2025, art. 4º: só reduz o que consta do demonstrativo de gastos tributários da LOA 2026 e dos regimes que ela lista (IN RFB 2.305/2025). O monofásico de autopeças (Lei 10.485) não consta da planilha do DGT da PLOA 2026 lida em 2026-10-22; o anexo da LOA final não foi lido. Outras alíquotas zero e isenções de PIS/Cofins que constem do DGT passam a pagar 10% da alíquota-padrão desde 2026-04-01 e não estão modeladas aqui.',
    'A majoração da presunção só incide sobre a parcela da receita acima de R$ 1,25 milhão por trimestre (IN RFB 2.305/2025, art. 15, com a IN 2.306/2026). Passando { quarterRevenueBeforeCents, operationCents } a presumidoCommerce/presumidoByActivity o acréscimo é exato por operação; com true é o teto e superestima o IRPJ/CSLL de quem passa pouco do limite. O Fixer usa a receita do trimestre das OS concluídas (a venda nova leva o acréscimo se o trimestre já passou de R$ 1,25 milhão); sem esse dado, cai no teto pela RBT12 acima de R$ 5 milhões. Só a venda que cruza o limite erra, e por pouco. Compensação entre trimestres e ajuste do último trimestre (§§ 4º e 5º) ficam com quem apura.',
  ],
};
