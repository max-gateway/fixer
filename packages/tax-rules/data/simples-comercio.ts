import type { TableMeta } from '../src/types.js';

// Simples Nacional, Anexo I (comércio): alíquotas nominais, parcelas a deduzir e repartição dos tributos, por período.
//
//  - até 2026-12-31: LC 123/2006, Anexo I, redação da LC 155/2016 (vigência desde 2018-01-01).
//  - de 2027-01-01 em diante: Anexo XVIII da LC 214/2025 (arts. 519 e 544, III, com a redação da LC 227/2026), que passa a
//    ser o Anexo I da LC 123. A repartição troca PIS e Cofins por CBS, entra o IBS e o ICMS cai ano a ano até 2033.
//
// Transcrito dos textos do Planalto lidos em 2026-10-13. Percentuais em % com 2 casas.

export interface SimplesShare {
  irpj: string;
  csll: string;
  cofins: string;
  pis: string;
  cbs: string;
  cpp: string;
  icms: string;
  ibs: string;
}

export interface SimplesBracket {
  bracket: 1 | 2 | 3 | 4 | 5 | 6;
  /** Limite superior da receita bruta em 12 meses (RBT12), em centavos, inclusive. */
  upToCents: bigint;
  nominalPct: string;
  /** Parcela a deduzir, em centavos. */
  deductionCents: bigint;
  /** Repartição da alíquota efetiva, em % da própria alíquota (soma 100). */
  share: SimplesShare;
}

export interface SimplesPeriod {
  id: string;
  from: string;
  to: string | null;
  source: string;
  brackets: SimplesBracket[];
}

const ZERO = '0.00';
const OLD = (cpp: string, icms: string): SimplesShare => ({ irpj: '5.50', csll: '3.50', cofins: '12.74', pis: '2.76', cbs: ZERO, cpp, icms, ibs: ZERO });
const OLD6: SimplesShare = { irpj: '13.50', csll: '10.00', cofins: '28.27', pis: '6.13', cbs: ZERO, cpp: '42.10', icms: ZERO, ibs: ZERO };
const NEW = (cbs: string, cpp: string, icms: string, ibs: string): SimplesShare => ({ irpj: '5.50', csll: '3.50', cofins: ZERO, pis: ZERO, cbs, cpp, icms, ibs });
const NEW6 = (irpj: string, csll: string, cbs: string, cpp: string): SimplesShare => ({ irpj, csll, cofins: ZERO, pis: ZERO, cbs, cpp, icms: ZERO, ibs: ZERO });

const LIMITS: [bigint, bigint][] = [
  [18_000_000n, 0n],
  [36_000_000n, 594_000n],
  [72_000_000n, 1_386_000n],
  [180_000_000n, 2_250_000n],
  [360_000_000n, 8_730_000n],
  [480_000_000n, 37_800_000n],
];
const NOMINAL_STD = ['4.00', '7.30', '9.50', '10.70', '14.30', '19.00'];
const NOMINAL_2027 = ['4.00', '7.30', '9.50', '10.70', '14.30', '18.90']; // 6ª faixa 18,90% em 2027 e 2028 (LC 214, Anexo XVIII)

function build(nominal: string[], shares: SimplesShare[]): SimplesBracket[] {
  return LIMITS.map(([upToCents, deductionCents], i) => ({
    bracket: (i + 1) as SimplesBracket['bracket'],
    upToCents,
    deductionCents,
    nominalPct: nominal[i]!,
    share: shares[i]!,
  }));
}

/** Faixas 1 e 2 compartilham a repartição; 3 a 5 também. */
const five = (a: SimplesShare, b: SimplesShare) => [a, a, b, b, b];

export const SIMPLES_COMERCIO: SimplesPeriod[] = [
  {
    id: 'LC123-AnexoI-2018',
    from: '2018-01-01',
    to: '2026-12-31',
    source: 'LC 123/2006, Anexo I (redação da LC 155/2016)',
    brackets: build(NOMINAL_STD, [...five(OLD('41.50', '34.00'), OLD('42.00', '33.50')), OLD6]),
  },
  {
    id: 'LC214-AnexoXVIII-2027-2028',
    from: '2027-01-01',
    to: '2028-12-31',
    source: 'LC 214/2025, Anexo XVIII (Anexo I da LC 123), anos-calendário 2027 e 2028',
    brackets: build(NOMINAL_2027, [...five(NEW('15.33', '41.50', '34.00', '0.17'), NEW('15.33', '42.00', '33.50', '0.17')), NEW6('13.58', '10.06', '34.02', '42.34')]),
  },
  {
    id: 'LC214-AnexoXVIII-2029',
    from: '2029-01-01',
    to: '2029-12-31',
    source: 'LC 214/2025, Anexo XVIII, ano-calendário 2029',
    brackets: build(NOMINAL_STD, [...five(NEW('15.50', '41.50', '30.60', '3.40'), NEW('15.50', '42.00', '30.15', '3.35')), NEW6('13.50', '10.00', '34.40', '42.10')]),
  },
  {
    id: 'LC214-AnexoXVIII-2030',
    from: '2030-01-01',
    to: '2030-12-31',
    source: 'LC 214/2025, Anexo XVIII, ano-calendário 2030',
    brackets: build(NOMINAL_STD, [...five(NEW('15.50', '41.50', '27.20', '6.80'), NEW('15.50', '42.00', '26.80', '6.70')), NEW6('13.50', '10.00', '34.40', '42.10')]),
  },
  {
    id: 'LC214-AnexoXVIII-2031',
    from: '2031-01-01',
    to: '2031-12-31',
    source: 'LC 214/2025, Anexo XVIII, ano-calendário 2031',
    brackets: build(NOMINAL_STD, [...five(NEW('15.50', '41.50', '23.80', '10.20'), NEW('15.50', '42.00', '23.45', '10.05')), NEW6('13.50', '10.00', '34.40', '42.10')]),
  },
  {
    id: 'LC214-AnexoXVIII-2032',
    from: '2032-01-01',
    to: '2032-12-31',
    source: 'LC 214/2025, Anexo XVIII, ano-calendário 2032',
    brackets: build(NOMINAL_STD, [...five(NEW('15.50', '41.50', '20.40', '13.60'), NEW('15.50', '42.00', '20.10', '13.40')), NEW6('13.50', '10.00', '34.40', '42.10')]),
  },
  {
    id: 'LC214-AnexoXVIII-2033',
    from: '2033-01-01',
    to: null,
    source: 'LC 214/2025, Anexo XVIII, a partir do ano-calendário 2033 (ICMS extinto: o IBS ocupa a parcela)',
    brackets: build(NOMINAL_STD, [...five(NEW('15.50', '41.50', ZERO, '34.00'), NEW('15.50', '42.00', ZERO, '33.50')), NEW6('13.50', '10.00', '34.40', '42.10')]),
  },
];

export const SIMPLES_COMERCIO_META: TableMeta = {
  id: 'simples-comercio',
  version: '2026-10-13.1',
  effectiveFrom: '2018-01-01',
  effectiveTo: null,
  sources: [
    { law: 'LC 123/2006, Anexo I (redação da LC 155/2016)', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm', retrievedAt: '2026-10-13' },
    { law: 'LC 214/2025, arts. 519 e 544 (III) e Anexo XVIII, com a redação da LC 227/2026', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm', retrievedAt: '2026-10-13' },
  ],
  validatedBy: null,
  caveats: [
    'Na 6ª faixa o ICMS é recolhido fora do DAS (repartição 0%); em 2027 e 2028 a 6ª faixa também não traz IBS.',
    'O texto da LC 214 repete a nominal de 18,90% na 6ª faixa de 2027 e 2028 e 19,00% a partir de 2029: transcrito como está; conferir com o contador e com a resolução do Comitê Gestor do Simples.',
    'RBT12 de empresa com menos de 12 meses de atividade exige proporcionalização, a cargo de quem chama.',
    'Optante que recolhe IBS/CBS por fora do DAS (para transferir crédito) não está modelado.',
    'A partir de 2027 a repartição fala em CBS e IBS no lugar de PIS/Cofins, mas o tratamento de ST, monofásico e segregação de receita no novo DAS depende de regulamentação que não está nos textos lidos.',
  ],
};
