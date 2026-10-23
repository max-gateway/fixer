import type { TableMeta } from '../src/types.js';

// Simples Nacional, Anexos II (indústria), III (serviços e locação), IV (construção, vigilância, limpeza, advocacia) e V (serviços
// intelectuais): alíquotas nominais, parcelas a deduzir e repartição por faixa.
//
//  - 2018-01-01 a 2026-12-31: LC 123/2006, Anexos II a V, redação da LC 155/2016.
//  - de 2027-01-01 em diante: LC 214/2025, Anexos XIX a XXII (Anexos II a V da LC 123), redação da LC 227/2026. PIS e Cofins saem
//    da repartição, entram CBS e IBS, o ICMS e o ISS caem ano a ano até 2033 e o teto do ISS na 5ª faixa também.
//
// A parte entre `<generated>` e `</generated>` é gerada pelo texto oficial (`npm run gen:simples-anexos`); `npm run verify:sources`
// roda o mesmo parser e compara. Não editar à mão. O Anexo I (comércio) fica em `simples-comercio.ts`.

export type SimplesAnnexId = 'II' | 'III' | 'IV' | 'V';
/** 'I' (comércio) fica em simples-comercio.ts e entra aqui só quando o cálculo unifica os anexos. */
export type SimplesAnnexAny = 'I' | SimplesAnnexId;
export type SimplesTaxKey = 'irpj' | 'csll' | 'cofins' | 'pis' | 'cbs' | 'cpp' | 'ipi' | 'icms' | 'iss' | 'ibs';

export interface AnnexBracket {
  bracket: 1 | 2 | 3 | 4 | 5 | 6;
  /** Limite superior da RBT12, em centavos, inclusive. */
  upToCents: bigint;
  nominalPct: string;
  /** Parcela a deduzir, em centavos. */
  deductionCents: bigint;
  /** Repartição da alíquota efetiva, em % da própria alíquota (soma 100). Tributo que não existe no anexo/período = 0.00. */
  share: Record<SimplesTaxKey, string>;
}

/**
 * Teto do ISS (LC 123, art. 18, § 1º-B, I): quando o ISS da 5ª faixa passaria de `issPct` % da receita, ele fica fixo nesse valor
 * e (alíquota efetiva − `issPct`) é repartido pelos demais tributos segundo `share` (soma 100, ISS = 0).
 */
export interface AnnexIssCap {
  issPct: string;
  bracket: 5;
  share: Record<SimplesTaxKey, string>;
}

export interface AnnexPeriod {
  id: string;
  annex: SimplesAnnexAny;
  from: string;
  to: string | null;
  source: string;
  issCap: AnnexIssCap | null;
  brackets: AnnexBracket[];
}

export const SIMPLES_ANEXOS: AnnexPeriod[] = [
  // <generated>
  {
    id: 'LC123-AnexoII-2018',
    annex: 'II',
    from: '2018-01-01',
    to: '2026-12-31',
    source: 'LC 123/2006, Anexo II (redação da LC 155/2016)',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '5.50', csll: '3.50', cofins: '11.51', pis: '2.49', cbs: '0.00', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.00' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '7.80', deductionCents: 594000n, share: { irpj: '5.50', csll: '3.50', cofins: '11.51', pis: '2.49', cbs: '0.00', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.00', deductionCents: 1386000n, share: { irpj: '5.50', csll: '3.50', cofins: '11.51', pis: '2.49', cbs: '0.00', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '11.20', deductionCents: 2250000n, share: { irpj: '5.50', csll: '3.50', cofins: '11.51', pis: '2.49', cbs: '0.00', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '14.70', deductionCents: 8550000n, share: { irpj: '5.50', csll: '3.50', cofins: '11.51', pis: '2.49', cbs: '0.00', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.00', deductionCents: 72000000n, share: { irpj: '8.50', csll: '7.50', cofins: '20.96', pis: '4.54', cbs: '0.00', cpp: '23.50', ipi: '35.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXIX-2027-2028',
    annex: 'II',
    from: '2027-01-01',
    to: '2028-12-31',
    source: 'LC 214/2025, Anexo XIX (Anexo II da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '13.85', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.15' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '7.80', deductionCents: 594000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '13.85', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.15' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.00', deductionCents: 1386000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '13.85', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.15' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '11.20', deductionCents: 2250000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '13.85', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.15' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '14.70', deductionCents: 8550000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '13.85', cpp: '37.50', ipi: '7.50', icms: '32.00', iss: '0.00', ibs: '0.15' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '29.90', deductionCents: 72000000n, share: { irpj: '8.53', csll: '7.53', cofins: '0.00', pis: '0.00', cbs: '25.22', cpp: '23.59', ipi: '35.13', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXIX-2029',
    annex: 'II',
    from: '2029-01-01',
    to: '2029-12-31',
    source: 'LC 214/2025, Anexo XIX (Anexo II da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '28.80', iss: '0.00', ibs: '3.20' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '7.80', deductionCents: 594000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '28.80', iss: '0.00', ibs: '3.20' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.00', deductionCents: 1386000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '28.80', iss: '0.00', ibs: '3.20' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '11.20', deductionCents: 2250000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '28.80', iss: '0.00', ibs: '3.20' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '14.70', deductionCents: 8550000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '28.80', iss: '0.00', ibs: '3.20' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.00', deductionCents: 72000000n, share: { irpj: '8.50', csll: '7.50', cofins: '0.00', pis: '0.00', cbs: '25.50', cpp: '23.50', ipi: '35.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXIX-2030',
    annex: 'II',
    from: '2030-01-01',
    to: '2030-12-31',
    source: 'LC 214/2025, Anexo XIX (Anexo II da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '25.60', iss: '0.00', ibs: '6.40' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '7.80', deductionCents: 594000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '25.60', iss: '0.00', ibs: '6.40' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.00', deductionCents: 1386000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '25.60', iss: '0.00', ibs: '6.40' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '11.20', deductionCents: 2250000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '25.60', iss: '0.00', ibs: '6.40' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '14.70', deductionCents: 8550000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '25.60', iss: '0.00', ibs: '6.40' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.00', deductionCents: 72000000n, share: { irpj: '8.50', csll: '7.50', cofins: '0.00', pis: '0.00', cbs: '25.50', cpp: '23.50', ipi: '35.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXIX-2031',
    annex: 'II',
    from: '2031-01-01',
    to: '2031-12-31',
    source: 'LC 214/2025, Anexo XIX (Anexo II da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '22.40', iss: '0.00', ibs: '9.60' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '7.80', deductionCents: 594000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '22.40', iss: '0.00', ibs: '9.60' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.00', deductionCents: 1386000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '22.40', iss: '0.00', ibs: '9.60' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '11.20', deductionCents: 2250000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '22.40', iss: '0.00', ibs: '9.60' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '14.70', deductionCents: 8550000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '22.40', iss: '0.00', ibs: '9.60' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.00', deductionCents: 72000000n, share: { irpj: '8.50', csll: '7.50', cofins: '0.00', pis: '0.00', cbs: '25.50', cpp: '23.50', ipi: '35.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXIX-2032',
    annex: 'II',
    from: '2032-01-01',
    to: '2032-12-31',
    source: 'LC 214/2025, Anexo XIX (Anexo II da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '19.20', iss: '0.00', ibs: '12.80' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '7.80', deductionCents: 594000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '19.20', iss: '0.00', ibs: '12.80' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.00', deductionCents: 1386000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '19.20', iss: '0.00', ibs: '12.80' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '11.20', deductionCents: 2250000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '19.20', iss: '0.00', ibs: '12.80' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '14.70', deductionCents: 8550000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '19.20', iss: '0.00', ibs: '12.80' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.00', deductionCents: 72000000n, share: { irpj: '8.50', csll: '7.50', cofins: '0.00', pis: '0.00', cbs: '25.50', cpp: '23.50', ipi: '35.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXIX-2033',
    annex: 'II',
    from: '2033-01-01',
    to: null,
    source: 'LC 214/2025, Anexo XIX (Anexo II da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '0.00', iss: '0.00', ibs: '32.00' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '7.80', deductionCents: 594000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '0.00', iss: '0.00', ibs: '32.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.00', deductionCents: 1386000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '0.00', iss: '0.00', ibs: '32.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '11.20', deductionCents: 2250000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '0.00', iss: '0.00', ibs: '32.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '14.70', deductionCents: 8550000n, share: { irpj: '5.50', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '14.00', cpp: '37.50', ipi: '7.50', icms: '0.00', iss: '0.00', ibs: '32.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.00', deductionCents: 72000000n, share: { irpj: '8.50', csll: '7.50', cofins: '0.00', pis: '0.00', cbs: '25.50', cpp: '23.50', ipi: '35.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC123-AnexoIII-2018',
    annex: 'III',
    from: '2018-01-01',
    to: '2026-12-31',
    source: 'LC 123/2006, Anexo III (redação da LC 155/2016)',
    issCap: { issPct: '5.00', bracket: 5, share: { irpj: '6.02', csll: '5.26', cofins: '19.28', pis: '4.18', cbs: '0.00', cpp: '65.26', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '6.00', deductionCents: 0n, share: { irpj: '4.00', csll: '3.50', cofins: '12.82', pis: '2.78', cbs: '0.00', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '33.50', ibs: '0.00' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '11.20', deductionCents: 936000n, share: { irpj: '4.00', csll: '3.50', cofins: '14.05', pis: '3.05', cbs: '0.00', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '32.00', ibs: '0.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '13.50', deductionCents: 1764000n, share: { irpj: '4.00', csll: '3.50', cofins: '13.64', pis: '2.96', cbs: '0.00', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '32.50', ibs: '0.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '16.00', deductionCents: 3564000n, share: { irpj: '4.00', csll: '3.50', cofins: '13.64', pis: '2.96', cbs: '0.00', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '32.50', ibs: '0.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '21.00', deductionCents: 12564000n, share: { irpj: '4.00', csll: '3.50', cofins: '12.82', pis: '2.78', cbs: '0.00', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '33.50', ibs: '0.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 64800000n, share: { irpj: '35.00', csll: '15.00', cofins: '16.03', pis: '3.47', cbs: '0.00', cpp: '30.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXX-2027-2028',
    annex: 'III',
    from: '2027-01-01',
    to: '2028-12-31',
    source: 'LC 214/2025, Anexo XX (Anexo III da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '5.00', bracket: 5, share: { irpj: '6.02', csll: '5.26', cofins: '0.00', pis: '0.00', cbs: '23.20', cpp: '65.26', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.26' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '6.00', deductionCents: 0n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.43', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '33.50', ibs: '0.17' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '11.20', deductionCents: 936000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.91', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '32.00', ibs: '0.19' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '13.50', deductionCents: 1764000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.41', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '32.50', ibs: '0.19' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '16.00', deductionCents: 3564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.41', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '32.50', ibs: '0.19' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '21.00', deductionCents: 12564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.43', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '33.50', ibs: '0.17' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '32.90', deductionCents: 64800000n, share: { irpj: '35.09', csll: '15.04', cofins: '0.00', pis: '0.00', cbs: '19.29', cpp: '30.58', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXX-2029',
    annex: 'III',
    from: '2029-01-01',
    to: '2029-12-31',
    source: 'LC 214/2025, Anexo XX (Anexo III da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '4.50', bracket: 5, share: { irpj: '5.73', csll: '5.01', cofins: '0.00', pis: '0.00', cbs: '22.33', cpp: '62.13', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '4.80' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '6.00', deductionCents: 0n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '30.15', ibs: '3.35' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '11.20', deductionCents: 936000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '17.10', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '28.80', ibs: '3.20' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '13.50', deductionCents: 1764000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '29.25', ibs: '3.25' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '16.00', deductionCents: 3564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '29.25', ibs: '3.25' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '21.00', deductionCents: 12564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '30.15', ibs: '3.35' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 64800000n, share: { irpj: '35.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.50', cpp: '30.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXX-2030',
    annex: 'III',
    from: '2030-01-01',
    to: '2030-12-31',
    source: 'LC 214/2025, Anexo XX (Anexo III da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '4.00', bracket: 5, share: { irpj: '5.46', csll: '4.78', cofins: '0.00', pis: '0.00', cbs: '21.31', cpp: '59.29', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '9.15' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '6.00', deductionCents: 0n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '26.80', ibs: '6.70' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '11.20', deductionCents: 936000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '17.10', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '25.60', ibs: '6.40' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '13.50', deductionCents: 1764000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '26.00', ibs: '6.50' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '16.00', deductionCents: 3564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '26.00', ibs: '6.50' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '21.00', deductionCents: 12564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '26.80', ibs: '6.70' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 64800000n, share: { irpj: '35.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.50', cpp: '30.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXX-2031',
    annex: 'III',
    from: '2031-01-01',
    to: '2031-12-31',
    source: 'LC 214/2025, Anexo XX (Anexo III da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '3.50', bracket: 5, share: { irpj: '5.23', csll: '4.57', cofins: '0.00', pis: '0.00', cbs: '20.38', cpp: '56.69', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '13.13' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '6.00', deductionCents: 0n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '23.45', ibs: '10.05' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '11.20', deductionCents: 936000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '17.10', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '22.40', ibs: '9.60' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '13.50', deductionCents: 1764000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '22.75', ibs: '9.75' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '16.00', deductionCents: 3564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '22.75', ibs: '9.75' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '21.00', deductionCents: 12564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '23.45', ibs: '10.05' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 64800000n, share: { irpj: '35.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.50', cpp: '30.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXX-2032',
    annex: 'III',
    from: '2032-01-01',
    to: '2032-12-31',
    source: 'LC 214/2025, Anexo XX (Anexo III da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '3.00', bracket: 5, share: { irpj: '5.01', csll: '4.38', cofins: '0.00', pis: '0.00', cbs: '19.52', cpp: '54.32', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '16.77' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '6.00', deductionCents: 0n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '20.10', ibs: '13.40' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '11.20', deductionCents: 936000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '17.10', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '19.20', ibs: '12.80' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '13.50', deductionCents: 1764000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '19.50', ibs: '13.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '16.00', deductionCents: 3564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '19.50', ibs: '13.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '21.00', deductionCents: 12564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '20.10', ibs: '13.40' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 64800000n, share: { irpj: '35.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.50', cpp: '30.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXX-2033',
    annex: 'III',
    from: '2033-01-01',
    to: null,
    source: 'LC 214/2025, Anexo XX (Anexo III da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '6.00', deductionCents: 0n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '33.50' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '11.20', deductionCents: 936000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '17.10', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '32.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '13.50', deductionCents: 1764000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '32.50' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '16.00', deductionCents: 3564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '16.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '32.50' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '21.00', deductionCents: 12564000n, share: { irpj: '4.00', csll: '3.50', cofins: '0.00', pis: '0.00', cbs: '15.60', cpp: '43.40', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '33.50' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 64800000n, share: { irpj: '35.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.50', cpp: '30.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC123-AnexoIV-2018',
    annex: 'IV',
    from: '2018-01-01',
    to: '2026-12-31',
    source: 'LC 123/2006, Anexo IV (redação da LC 155/2016)',
    issCap: { issPct: '5.00', bracket: 5, share: { irpj: '31.33', csll: '32.00', cofins: '30.13', pis: '6.54', cbs: '0.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '18.80', csll: '15.20', cofins: '17.67', pis: '3.83', cbs: '0.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '44.50', ibs: '0.00' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '9.00', deductionCents: 810000n, share: { irpj: '19.80', csll: '15.20', cofins: '20.55', pis: '4.45', cbs: '0.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.00', ibs: '0.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.20', deductionCents: 1242000n, share: { irpj: '20.80', csll: '15.20', cofins: '19.73', pis: '4.27', cbs: '0.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.00', ibs: '0.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '14.00', deductionCents: 3978000n, share: { irpj: '17.80', csll: '19.20', cofins: '18.90', pis: '4.10', cbs: '0.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.00', ibs: '0.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '22.00', deductionCents: 18378000n, share: { irpj: '18.80', csll: '19.20', cofins: '18.08', pis: '3.92', cbs: '0.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.00', ibs: '0.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 82800000n, share: { irpj: '53.50', csll: '21.50', cofins: '20.55', pis: '4.45', cbs: '0.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXI-2027-2028',
    annex: 'IV',
    from: '2027-01-01',
    to: '2028-12-31',
    source: 'LC 214/2025, Anexo XXI (Anexo IV da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '5.00', bracket: 5, share: { irpj: '31.33', csll: '32.00', cofins: '0.00', pis: '0.00', cbs: '36.27', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.40' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '18.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '21.26', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '44.50', ibs: '0.24' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '9.00', deductionCents: 810000n, share: { irpj: '19.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '24.73', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.00', ibs: '0.27' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.20', deductionCents: 1242000n, share: { irpj: '20.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '23.74', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.00', ibs: '0.26' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '14.00', deductionCents: 3978000n, share: { irpj: '17.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '22.75', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.00', ibs: '0.25' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '22.00', deductionCents: 18378000n, share: { irpj: '18.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '21.76', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.00', ibs: '0.24' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '32.90', deductionCents: 82800000n, share: { irpj: '53.71', csll: '21.59', cofins: '0.00', pis: '0.00', cbs: '24.70', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXI-2029',
    annex: 'IV',
    from: '2029-01-01',
    to: '2029-12-31',
    source: 'LC 214/2025, Anexo XXI (Anexo IV da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '4.50', bracket: 5, share: { irpj: '29.38', csll: '30.00', cofins: '0.00', pis: '0.00', cbs: '34.38', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '6.25' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '18.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '21.50', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '40.05', ibs: '4.45' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '9.00', deductionCents: 810000n, share: { irpj: '19.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '36.00', ibs: '4.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.20', deductionCents: 1242000n, share: { irpj: '20.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '24.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '36.00', ibs: '4.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '14.00', deductionCents: 3978000n, share: { irpj: '17.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '23.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '36.00', ibs: '4.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '22.00', deductionCents: 18378000n, share: { irpj: '18.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '22.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '36.00', ibs: '4.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 82800000n, share: { irpj: '53.50', csll: '21.50', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXI-2030',
    annex: 'IV',
    from: '2030-01-01',
    to: '2030-12-31',
    source: 'LC 214/2025, Anexo XXI (Anexo IV da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '4.00', bracket: 5, share: { irpj: '27.65', csll: '28.24', cofins: '0.00', pis: '0.00', cbs: '32.35', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '11.76' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '18.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '21.50', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '35.60', ibs: '8.90' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '9.00', deductionCents: 810000n, share: { irpj: '19.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '32.00', ibs: '8.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.20', deductionCents: 1242000n, share: { irpj: '20.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '24.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '32.00', ibs: '8.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '14.00', deductionCents: 3978000n, share: { irpj: '17.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '23.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '32.00', ibs: '8.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '22.00', deductionCents: 18378000n, share: { irpj: '18.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '22.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '32.00', ibs: '8.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 82800000n, share: { irpj: '53.50', csll: '21.50', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXI-2031',
    annex: 'IV',
    from: '2031-01-01',
    to: '2031-12-31',
    source: 'LC 214/2025, Anexo XXI (Anexo IV da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '3.50', bracket: 5, share: { irpj: '26.11', csll: '26.67', cofins: '0.00', pis: '0.00', cbs: '30.56', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '16.67' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '18.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '21.50', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '31.15', ibs: '13.35' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '9.00', deductionCents: 810000n, share: { irpj: '19.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '28.00', ibs: '12.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.20', deductionCents: 1242000n, share: { irpj: '20.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '24.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '28.00', ibs: '12.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '14.00', deductionCents: 3978000n, share: { irpj: '17.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '23.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '28.00', ibs: '12.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '22.00', deductionCents: 18378000n, share: { irpj: '18.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '22.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '28.00', ibs: '12.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 82800000n, share: { irpj: '53.50', csll: '21.50', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXI-2032',
    annex: 'IV',
    from: '2032-01-01',
    to: '2032-12-31',
    source: 'LC 214/2025, Anexo XXI (Anexo IV da LC 123), com a redação da LC 227/2026',
    issCap: { issPct: '3.00', bracket: 5, share: { irpj: '24.74', csll: '25.26', cofins: '0.00', pis: '0.00', cbs: '28.95', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '21.05' } },
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '18.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '21.50', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '26.70', ibs: '17.80' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '9.00', deductionCents: 810000n, share: { irpj: '19.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '24.00', ibs: '16.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.20', deductionCents: 1242000n, share: { irpj: '20.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '24.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '24.00', ibs: '16.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '14.00', deductionCents: 3978000n, share: { irpj: '17.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '23.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '24.00', ibs: '16.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '22.00', deductionCents: 18378000n, share: { irpj: '18.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '22.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '24.00', ibs: '16.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 82800000n, share: { irpj: '53.50', csll: '21.50', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXI-2033',
    annex: 'IV',
    from: '2033-01-01',
    to: null,
    source: 'LC 214/2025, Anexo XXI (Anexo IV da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '4.50', deductionCents: 0n, share: { irpj: '18.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '21.50', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '44.50' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '9.00', deductionCents: 810000n, share: { irpj: '19.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '40.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '10.20', deductionCents: 1242000n, share: { irpj: '20.80', csll: '15.20', cofins: '0.00', pis: '0.00', cbs: '24.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '40.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '14.00', deductionCents: 3978000n, share: { irpj: '17.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '23.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '40.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '22.00', deductionCents: 18378000n, share: { irpj: '18.80', csll: '19.20', cofins: '0.00', pis: '0.00', cbs: '22.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '40.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '33.00', deductionCents: 82800000n, share: { irpj: '53.50', csll: '21.50', cofins: '0.00', pis: '0.00', cbs: '25.00', cpp: '0.00', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC123-AnexoV-2018',
    annex: 'V',
    from: '2018-01-01',
    to: '2026-12-31',
    source: 'LC 123/2006, Anexo V (redação da LC 155/2016)',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '15.50', deductionCents: 0n, share: { irpj: '25.00', csll: '15.00', cofins: '14.10', pis: '3.05', cbs: '0.00', cpp: '28.85', ipi: '0.00', icms: '0.00', iss: '14.00', ibs: '0.00' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '18.00', deductionCents: 450000n, share: { irpj: '23.00', csll: '15.00', cofins: '14.10', pis: '3.05', cbs: '0.00', cpp: '27.85', ipi: '0.00', icms: '0.00', iss: '17.00', ibs: '0.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '19.50', deductionCents: 990000n, share: { irpj: '24.00', csll: '15.00', cofins: '14.92', pis: '3.23', cbs: '0.00', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '19.00', ibs: '0.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '20.50', deductionCents: 1710000n, share: { irpj: '21.00', csll: '15.00', cofins: '15.74', pis: '3.41', cbs: '0.00', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '21.00', ibs: '0.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '23.00', deductionCents: 6210000n, share: { irpj: '23.00', csll: '12.50', cofins: '14.10', pis: '3.05', cbs: '0.00', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '23.50', ibs: '0.00' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.50', deductionCents: 54000000n, share: { irpj: '35.00', csll: '15.50', cofins: '16.44', pis: '3.56', cbs: '0.00', cpp: '29.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXII-2027-2028',
    annex: 'V',
    from: '2027-01-01',
    to: '2028-12-31',
    source: 'LC 214/2025, Anexo XXII (Anexo V da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '15.50', deductionCents: 0n, share: { irpj: '25.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '16.96', cpp: '28.85', ipi: '0.00', icms: '0.00', iss: '14.00', ibs: '0.19' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '18.00', deductionCents: 450000n, share: { irpj: '23.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '16.96', cpp: '27.85', ipi: '0.00', icms: '0.00', iss: '17.00', ibs: '0.19' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '19.50', deductionCents: 990000n, share: { irpj: '24.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.95', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '19.00', ibs: '0.20' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '20.50', deductionCents: 1710000n, share: { irpj: '21.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '18.94', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '21.00', ibs: '0.21' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '23.00', deductionCents: 6210000n, share: { irpj: '23.00', csll: '12.50', cofins: '0.00', pis: '0.00', cbs: '16.96', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '23.50', ibs: '0.19' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.40', deductionCents: 54000000n, share: { irpj: '35.10', csll: '15.54', cofins: '0.00', pis: '0.00', cbs: '19.78', cpp: '29.58', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXII-2029',
    annex: 'V',
    from: '2029-01-01',
    to: '2029-12-31',
    source: 'LC 214/2025, Anexo XXII (Anexo V da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '15.50', deductionCents: 0n, share: { irpj: '25.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '28.85', ipi: '0.00', icms: '0.00', iss: '12.60', ibs: '1.40' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '18.00', deductionCents: 450000n, share: { irpj: '23.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '27.85', ipi: '0.00', icms: '0.00', iss: '15.30', ibs: '1.70' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '19.50', deductionCents: 990000n, share: { irpj: '24.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '18.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '17.10', ibs: '1.90' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '20.50', deductionCents: 1710000n, share: { irpj: '21.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '18.90', ibs: '2.10' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '23.00', deductionCents: 6210000n, share: { irpj: '23.00', csll: '12.50', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '21.15', ibs: '2.35' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.50', deductionCents: 54000000n, share: { irpj: '35.00', csll: '15.50', cofins: '0.00', pis: '0.00', cbs: '20.00', cpp: '29.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXII-2030',
    annex: 'V',
    from: '2030-01-01',
    to: '2030-12-31',
    source: 'LC 214/2025, Anexo XXII (Anexo V da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '15.50', deductionCents: 0n, share: { irpj: '25.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '28.85', ipi: '0.00', icms: '0.00', iss: '11.20', ibs: '2.80' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '18.00', deductionCents: 450000n, share: { irpj: '23.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '27.85', ipi: '0.00', icms: '0.00', iss: '13.60', ibs: '3.40' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '19.50', deductionCents: 990000n, share: { irpj: '24.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '18.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '15.20', ibs: '3.80' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '20.50', deductionCents: 1710000n, share: { irpj: '21.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '16.80', ibs: '4.20' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '23.00', deductionCents: 6210000n, share: { irpj: '23.00', csll: '12.50', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '18.80', ibs: '4.70' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.50', deductionCents: 54000000n, share: { irpj: '35.00', csll: '15.50', cofins: '0.00', pis: '0.00', cbs: '20.00', cpp: '29.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXII-2031',
    annex: 'V',
    from: '2031-01-01',
    to: '2031-12-31',
    source: 'LC 214/2025, Anexo XXII (Anexo V da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '15.50', deductionCents: 0n, share: { irpj: '25.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '28.85', ipi: '0.00', icms: '0.00', iss: '9.80', ibs: '4.20' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '18.00', deductionCents: 450000n, share: { irpj: '23.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '27.85', ipi: '0.00', icms: '0.00', iss: '11.90', ibs: '5.10' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '19.50', deductionCents: 990000n, share: { irpj: '24.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '18.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '13.30', ibs: '5.70' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '20.50', deductionCents: 1710000n, share: { irpj: '21.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '14.70', ibs: '6.30' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '23.00', deductionCents: 6210000n, share: { irpj: '23.00', csll: '12.50', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '16.45', ibs: '7.05' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.50', deductionCents: 54000000n, share: { irpj: '35.00', csll: '15.50', cofins: '0.00', pis: '0.00', cbs: '20.00', cpp: '29.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXII-2032',
    annex: 'V',
    from: '2032-01-01',
    to: '2032-12-31',
    source: 'LC 214/2025, Anexo XXII (Anexo V da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '15.50', deductionCents: 0n, share: { irpj: '25.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '28.85', ipi: '0.00', icms: '0.00', iss: '8.40', ibs: '5.60' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '18.00', deductionCents: 450000n, share: { irpj: '23.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '27.85', ipi: '0.00', icms: '0.00', iss: '10.20', ibs: '6.80' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '19.50', deductionCents: 990000n, share: { irpj: '24.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '18.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '11.40', ibs: '7.60' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '20.50', deductionCents: 1710000n, share: { irpj: '21.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '12.60', ibs: '8.40' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '23.00', deductionCents: 6210000n, share: { irpj: '23.00', csll: '12.50', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '14.10', ibs: '9.40' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.50', deductionCents: 54000000n, share: { irpj: '35.00', csll: '15.50', cofins: '0.00', pis: '0.00', cbs: '20.00', cpp: '29.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  {
    id: 'LC214-AnexoXXII-2033',
    annex: 'V',
    from: '2033-01-01',
    to: null,
    source: 'LC 214/2025, Anexo XXII (Anexo V da LC 123), com a redação da LC 227/2026',
    issCap: null,
    brackets: [
      { bracket: 1, upToCents: 18000000n, nominalPct: '15.50', deductionCents: 0n, share: { irpj: '25.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '28.85', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '14.00' } },
      { bracket: 2, upToCents: 36000000n, nominalPct: '18.00', deductionCents: 450000n, share: { irpj: '23.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '27.85', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '17.00' } },
      { bracket: 3, upToCents: 72000000n, nominalPct: '19.50', deductionCents: 990000n, share: { irpj: '24.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '18.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '19.00' } },
      { bracket: 4, upToCents: 180000000n, nominalPct: '20.50', deductionCents: 1710000n, share: { irpj: '21.00', csll: '15.00', cofins: '0.00', pis: '0.00', cbs: '19.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '21.00' } },
      { bracket: 5, upToCents: 360000000n, nominalPct: '23.00', deductionCents: 6210000n, share: { irpj: '23.00', csll: '12.50', cofins: '0.00', pis: '0.00', cbs: '17.15', cpp: '23.85', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '23.50' } },
      { bracket: 6, upToCents: 480000000n, nominalPct: '30.50', deductionCents: 54000000n, share: { irpj: '35.00', csll: '15.50', cofins: '0.00', pis: '0.00', cbs: '20.00', cpp: '29.50', ipi: '0.00', icms: '0.00', iss: '0.00', ibs: '0.00' } },
    ],
  },
  // </generated>
];

export const SIMPLES_ANEXOS_META: TableMeta = {
  id: 'simples-anexos',
  version: '2026-10-22.1',
  effectiveFrom: '2018-01-01',
  effectiveTo: null,
  sources: [
    { law: 'LC 123/2006, Anexos II a V (redação da LC 155/2016)', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm', retrievedAt: '2026-10-22' },
    { law: 'LC 214/2025, Anexos XIX a XXII, com a redação da LC 227/2026', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm', retrievedAt: '2026-10-22' },
  ],
  validatedBy: null,
  caveats: [
    'Quem usa o Anexo III ou o V é decidido pela atividade (CNAE) e, no III/V, pelo Fator R: a escolha do anexo é de quem chama (ver simplesAnnexByFatorR).',
    'No Anexo IV a CPP não está no DAS: é recolhida à parte (LC 123, art. 18, § 5º-C); a função devolve cppOutsideDas.',
    'Sublimite de ICMS e ISS: acima dele (R$ 3,6 milhões na regra geral, menor em UFs que adotaram sublimite próprio) esses tributos saem do DAS e seguem a legislação local.',
    'RBT12 de empresa com menos de 12 meses de atividade exige proporcionalização, a cargo de quem chama.',
    'Atividades com incidência simultânea de IPI e ISS, locação de bens móveis, transporte e comunicação combinam partes de anexos (art. 18, §§ 4º, 5º-E e 5º-G): não modeladas.',
    'Em 2027 o recolhimento de IBS/CBS por fora do DAS (para transferir crédito) e a segregação de monofásico/ST no novo DAS dependem de regulamentação do Comitê Gestor.',
  ],
};
