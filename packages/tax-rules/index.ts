import { CFOP_META } from './data/cfop.js';
import { CST_CSOSN_META } from './data/cst-csosn.js';
import { FEDERAL_LUCRO_META } from './data/federal-lucro.js';
import { IBS_CBS_REFERENCE_META } from './data/ibs-cbs-referencia.js';
import { IBS_CBS_TRANSITION_META } from './data/ibs-cbs-transition.js';
import { ICMS_INTERESTADUAL_META } from './data/icms-interestadual.js';
import { MONOFASICO_AUTOPECAS_META } from './data/monofasico-autopecas.js';
import { SIMPLES_COMERCIO_META } from './data/simples-comercio.js';
import { ST_AUTOPECAS_META } from './data/st-autopecas-anexo-ii.js';
import { ST_AUTOPECAS_PROTOCOLO_META } from './data/st-autopecas-protocolo.js';
import { PE_ANTECIPACAO_SIMPLES_META, PE_ST_AUTOPECAS_META, PE_ST_PNEUS_META } from './data/pe-icms.js';
import { CNAE_LC116_META } from './data/cnae-lc116.js';

export const TABLES = [
  SIMPLES_COMERCIO_META,
  MONOFASICO_AUTOPECAS_META,
  IBS_CBS_TRANSITION_META,
  IBS_CBS_REFERENCE_META,
  ST_AUTOPECAS_META,
  ST_AUTOPECAS_PROTOCOLO_META,
  ICMS_INTERESTADUAL_META,
  FEDERAL_LUCRO_META,
  CFOP_META,
  CST_CSOSN_META,
  PE_ST_AUTOPECAS_META,
  PE_ST_PNEUS_META,
  PE_ANTECIPACAO_SIMPLES_META,
  CNAE_LC116_META,
];

/** Identificador único das versões de todas as tabelas; vai no snapshot de cada preço calculado. */
export const TAX_RULES_PACKAGE_VERSION = TABLES.map((t) => `${t.id}@${t.version}`).join('+');

export { SIMPLES_COMERCIO, SIMPLES_COMERCIO_META, type SimplesBracket, type SimplesPeriod, type SimplesShare } from './data/simples-comercio.js';
export { MONOFASICO_AUTOPECAS, MONOFASICO_AUTOPECAS_META, type MonofasicoEntry, type MonofasicoKind } from './data/monofasico-autopecas.js';
export { IBS_CBS_TRANSITION, IBS_CBS_TRANSITION_META, type TransitionPeriod } from './data/ibs-cbs-transition.js';
export { IBS_CBS_REFERENCE, IBS_CBS_REFERENCE_META, IBS_CBS_REDUCED_AUTOPECAS, type ReducedRateItem, type ReferenceRate } from './data/ibs-cbs-referencia.js';
export { ST_AUTOPECAS_ANEXO_II, ST_AUTOPECAS_META, type StAutopecaItem } from './data/st-autopecas-anexo-ii.js';
export { ST_AUTOPECAS_PROTOCOLO, ST_AUTOPECAS_PROTOCOLO_META, type StProtocolPeriod } from './data/st-autopecas-protocolo.js';
export { ICMS_INTERESTADUAL_META, UF_REGION } from './data/icms-interestadual.js';
export { FEDERAL_LUCRO, FEDERAL_LUCRO_META, PRESUMIDO_SURCHARGE, type RateLine } from './data/federal-lucro.js';
export { CFOP, CFOP_META, type CfopEntry } from './data/cfop.js';
export { CRT, CSOSN, CST_CSOSN_META, CST_ICMS, ORIGEM, type CodeEntry } from './data/cst-csosn.js';
export { simplesRate, simplesBracketFor, simplesPeriodFor, parseCents, type SimplesRate } from './src/simples.js';
export { monofasicoAutopeca, type MonofasicoResult, type MonofasicoStatus } from './src/monofasico.js';
export { transitionFor, legacyTaxes } from './src/transition.js';
export { stAutopecaItems, stAutopecaCest, stProtocolo, type StProtocolStatus } from './src/st.js';
export { interstateRate, ORIGIN_TAXED_AT_4, type InterstateRate } from './src/icms.js';
export { federalLines, presumidoCommerce, type PresumidoCommerce } from './src/federal.js';
export { cfopInfo, cfopProfile, CFOP_NOT_RESALE_NATURES, CFOP_RESALE_NATURES, type CfopProfile } from './src/cfop.js';
export { icmsCreditAllowed, isStPaidBefore } from './src/cst.js';
export { referenceRate, reducedRateForNcm } from './src/reform.js';
export { inForce, type TableMeta, type RuleSource } from './src/types.js';
export {
  PE_INTERNAL_RATE_PCT,
  PE_ST_AUTOPECAS_ORIGINS,
  PE_ST_AUTOPECAS_MVA,
  PE_ST_AUTOPECAS_META,
  PE_ANTECIPACAO_SIMPLES,
  PE_ANTECIPACAO_SIMPLES_META,
  PE_ST_PNEUS,
  PE_ST_PNEUS_META,
  type PePneuItem,
  type PeStOriginPeriod,
  type PeSimplesSize,
} from './data/pe-icms.js';
export { mvaAdjusted, peStAutopecasOrigin, peAntecipacaoSimples, pePneuItem, type PeStOriginStatus, type PeAntecipacaoSimples, type PeAntecipacaoBasis, type PeAntecipacaoAssumption } from './src/pe.js';
export { CNAE_LC116, CNAE_LC116_META, LC116_ITEM_14_01, type CnaeServiceEntry } from './data/cnae-lc116.js';
export { internalModalRatePct, normalizeCnae, serviceItemForCnae } from './src/cnae.js';
