import { CFOP_META } from './data/cfop.js';
import { CST_CSOSN_META } from './data/cst-csosn.js';
import { FEDERAL_LUCRO_META } from './data/federal-lucro.js';
import { IBS_CBS_REFERENCE_META } from './data/ibs-cbs-referencia.js';
import { IBS_CBS_TRANSITION_META } from './data/ibs-cbs-transition.js';
import { ICMS_INTERESTADUAL_META } from './data/icms-interestadual.js';
import { MONOFASICO_AUTOPECAS_META } from './data/monofasico-autopecas.js';
import { PE_ICMS_INTERNO_META } from './data/pe-icms-interno.js';
import { ISS_RECIFE_META } from './data/iss-recife.js';
import { ISS_LC116_META } from './data/iss-lc116.js';
import { IBS_CBS_REDUCTIONS_META } from './data/ibs-cbs-reducoes.js';
import { SELETIVO_META } from './data/imposto-seletivo.js';
import { TIPI_META } from './data/tipi.js';
import { SIMPLES_ANEXOS_META } from './data/simples-anexos.js';
import { SIMPLES_COMERCIO_META } from './data/simples-comercio.js';
import { ST_AUTOPECAS_META } from './data/st-autopecas-anexo-ii.js';
import { ST_AUTOPECAS_PROTOCOLO_META } from './data/st-autopecas-protocolo.js';
import { PE_ANTECIPACAO_SIMPLES_META, PE_ST_AUTOPECAS_META, PE_ST_PNEUS_META } from './data/pe-icms.js';
import { CNAE_LC116_META } from './data/cnae-lc116.js';

export const TABLES = [
  SIMPLES_COMERCIO_META,
  SIMPLES_ANEXOS_META,
  TIPI_META,
  SELETIVO_META,
  IBS_CBS_REDUCTIONS_META,
  ISS_LC116_META,
  ISS_RECIFE_META,
  PE_ICMS_INTERNO_META,
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
export { simplesRate, simplesBracketFor, simplesPeriodFor, simplesServicoRate, parseCents, type SimplesRate, type ServicoRate } from './src/simples.js';
export { SIMPLES_SERVICOS_ANEXO_III, type ServicoBracket, type ServicoShare } from './data/simples-servicos.js';
export { SIMPLES_ANEXOS, SIMPLES_ANEXOS_META, type AnnexBracket, type AnnexIssCap, type AnnexPeriod, type SimplesAnnexId, type SimplesTaxKey } from './data/simples-anexos.js';
export {
  SIMPLES_CEILING_CENTS,
  SIMPLES_GENERAL_SUBLIMIT_CENTS,
  SIMPLES_TAX_KEYS,
  simplesAnnexPeriod,
  simplesDas,
  simplesFatorR,
  simplesNacional,
  type FatorR,
  type SimplesAnnex,
  type SimplesDas,
  type SimplesNacionalOptions,
  type SimplesNacionalRate,
  type SimplesReductions,
} from './src/simples-nacional.js';
export { ISS_LC116_META, ISS_LIMITS, ISS_PLACE_RULES, LC116_GROUPS, LC116_ITEMS, type IssPlace, type IssPlaceRule, type Lc116Item } from './data/iss-lc116.js';
export { issPlace, issRateCheck, lc116Item, type IssPlaceResult, type IssRateStatus } from './src/iss.js';
export { IBS_CBS_REDUCTIONS, IBS_CBS_REDUCTIONS_META, type ReductionItem } from './data/ibs-cbs-reducoes.js';
export { SELETIVO, SELETIVO_META, type SeletivoCategory, type SeletivoEntry } from './data/imposto-seletivo.js';
export { impostoSeletivo, type SeletivoResult, type SeletivoStatus } from './src/seletivo.js';
export { TIPI_LAST_UPDATE, TIPI_META } from './data/tipi.js';
export { ipiRate, TIPI_EFFECTIVE_FROM, tipiSize, type IpiExAlternative, type IpiKind, type IpiResult, type IpiStatus } from './src/ipi.js';
export { monofasicoAutopeca, type MonofasicoResult, type MonofasicoStatus } from './src/monofasico.js';
export { transitionFor, legacyTaxes } from './src/transition.js';
export { stAutopecaItems, stAutopecaCest, stProtocolo, type StProtocolStatus } from './src/st.js';
export { interstateRate, ORIGIN_TAXED_AT_4, type InterstateRate } from './src/icms.js';
export { federalLines, pisCofinsStandard, presumidoByActivity, presumidoCommerce, type PisCofinsStandard, type PresumidoCommerce, type PresumidoSurchargeInput } from './src/federal.js';
export { PRESUMPTION, type PresumidoActivity, type PresumptionLine } from './data/presuncao.js';
export { cfopInfo, cfopProfile, CFOP_NOT_RESALE_NATURES, CFOP_RESALE_NATURES, type CfopProfile } from './src/cfop.js';
export { icmsCreditAllowed, isStPaidBefore } from './src/cst.js';
export { referenceRate, reducedRateCandidates, reducedRateForNcm, type ReductionCandidate } from './src/reform.js';
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
export { SOURCE_CHECKS } from './data/source-checks.js';
export { sourceCheck, nextStamps, renderStamps, type SourceCheckStamp, type StampOutcome } from './src/source-checks.js';
export { TAX_COVERAGE, taxCoverage, type CoverageStatus, type TaxCoverage } from './src/coverage.js';
export { ISS_RECIFE_META, ISS_RECIFE_RULES, RECIFE_IBGE } from './data/iss-recife.js';
export { issRate, type IssRecifeResult, type IssRecifeStatus } from './src/iss-recife.js';
export { PE_ICMS_ANNEX_OVERLAPS_REVIEWED, PE_ICMS_INTERNAL_MODAL, PE_ICMS_INTERNO_META } from './data/pe-icms-interno.js';
export { peInternalRate, type PeInternalResult, type PeInternalStatus } from './src/pe-icms-interno.js';
