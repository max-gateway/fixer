import type { TableMeta } from '../src/types.js';

// Transição da reforma tributária, LC 214/2025 com as alterações da LC 227/2026 (texto do Planalto lido em
// 2026-10-13). Só entra o que a lei fixa em número; o que depende de ato do Senado ou do TCU (alíquota de referência
// da CBS e do IBS) fica nulo e NÃO é inventado.

export interface TransitionPeriod {
  from: string;
  to: string;
  /** Alíquotas em % fixadas na lei, ou null quando dependem de alíquota de referência. */
  ibsStatePct: string | null;
  ibsMunicipalPct: string | null;
  cbsPct: string | null;
  /** CBS = alíquota de referência menos este número de pontos percentuais (art. 347). */
  cbsReferenceMinusPp: string | null;
  /** Redução do ICMS em % da alíquota vigente em 2028 (100 = extinto). */
  icmsReductionPct: string;
  /** PIS/Cofins existem (e, com eles, o monofásico da Lei 10.485). */
  pisCofinsInForce: boolean;
  /** Optantes do Simples são cobrados de IBS/CBS neste período? Em 2026 a lei os exclui. */
  simplesOptantesCharged: boolean;
  articles: string;
}

const REF = null;
const FUTURE = { ibsStatePct: REF, ibsMunicipalPct: REF, cbsPct: REF, cbsReferenceMinusPp: REF, pisCofinsInForce: false, simplesOptantesCharged: true };

export const IBS_CBS_TRANSITION: TransitionPeriod[] = [
  { from: '2026-01-01', to: '2026-12-31', ibsStatePct: '0.10', ibsMunicipalPct: '0.00', cbsPct: '0.90', cbsReferenceMinusPp: REF, icmsReductionPct: '0', pisCofinsInForce: true, simplesOptantesCharged: false, articles: 'LC 214/2025 arts. 343, 346 e 348 (III, c)' },
  { from: '2027-01-01', to: '2028-12-31', ibsStatePct: '0.05', ibsMunicipalPct: '0.05', cbsPct: REF, cbsReferenceMinusPp: '0.1', icmsReductionPct: '0', pisCofinsInForce: false, simplesOptantesCharged: true, articles: 'LC 214/2025 arts. 344 e 347; art. 542 (extingue PIS/Cofins)' },
  { from: '2029-01-01', to: '2029-12-31', ...FUTURE, icmsReductionPct: '10', articles: 'LC 214/2025 arts. 361 e 501 (LC 87/1996, art. 31-A)' },
  { from: '2030-01-01', to: '2030-12-31', ...FUTURE, icmsReductionPct: '20', articles: 'LC 214/2025 arts. 362 e 501' },
  { from: '2031-01-01', to: '2031-12-31', ...FUTURE, icmsReductionPct: '30', articles: 'LC 214/2025 arts. 363 e 501' },
  { from: '2032-01-01', to: '2032-12-31', ...FUTURE, icmsReductionPct: '40', articles: 'LC 214/2025 arts. 364 e 501' },
  { from: '2033-01-01', to: '9999-12-31', ...FUTURE, icmsReductionPct: '100', articles: 'LC 214/2025 art. 365; revogação da LC 87/1996 a partir de 01/01/2033' },
];

export const IBS_CBS_TRANSITION_META: TableMeta = {
  id: 'ibs-cbs-transition',
  version: '2026-10-13.1',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  sources: [
    { law: 'LC 214/2025 (com as alterações da LC 227/2026), arts. 342 a 369, 501, 508 e 542', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm', retrievedAt: '2026-10-13' },
  ],
  validatedBy: null,
  caveats: [
    'As alíquotas de referência da CBS e do IBS a partir de 2027 dependem de ato do Senado e do TCU e não estão no texto da lei: ficam nulas até alguém informar.',
    'A tabela diz QUANDO e QUANTO a lei fixa; não calcula crédito nem trata regimes diferenciados (reduções, cesta básica) nem a redução do ISS (art. 508).',
    'Optante do Simples que recolhe IBS/CBS fora do DAS (para transferir crédito) não está modelado.',
    'A relação de produtos com alíquota reduzida ou zero (cClassTrib por NCM/NBS) NÃO está aqui; precisa de tabela própria quando o leiaute da NF-e a exigir.',
  ],
};
