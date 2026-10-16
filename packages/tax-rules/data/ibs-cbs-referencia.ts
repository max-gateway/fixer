import type { TableMeta } from '../src/types.js';

// Reforma tributária (IBS/CBS): (1) alíquotas de referência, que a LC 214/2025 manda o Senado fixar por resolução com base em
// cálculos do TCU; (2) as reduções de alíquota da LC 214 que alcançam NCM de autopeças (levantamento feito cruzando os NCM dos
// Anexos I a XVI com os NCM do Anexo II do Convênio ICMS 142/2018 e com a lista monofásica). Lido do Planalto em 2026-10-13.

export interface ReferenceRate {
  /** Ano de vigência. */
  year: number;
  /** CBS, IBS estadual e IBS municipal em %; null enquanto o Senado não fixou. */
  cbsPct: string | null;
  ibsStatePct: string | null;
  ibsMunicipalPct: string | null;
  status: 'PENDENTE' | 'FIXADA';
  /** Resolução do Senado, quando fixada. */
  resolution: string | null;
  /** Data limite do Senado para fixar (art. 349, § 1º, II). */
  senateDeadline: string;
}

// Art. 349, § 1º: TCU envia os cálculos ao Senado até 15/09 do ano anterior; o Senado fixa até 31/10. Se passar de 22/12 sem
// fixação, valem os cálculos do TCU (§ 2º). Em 2026 os prazos da CBS de 2027 foram prorrogados em 45 dias (art. 353, § 2º).
export const IBS_CBS_REFERENCE: ReferenceRate[] = [
  { year: 2027, cbsPct: null, ibsStatePct: null, ibsMunicipalPct: null, status: 'PENDENTE', resolution: null, senateDeadline: '2026-10-31' },
  { year: 2028, cbsPct: null, ibsStatePct: null, ibsMunicipalPct: null, status: 'PENDENTE', resolution: null, senateDeadline: '2027-10-31' },
  { year: 2029, cbsPct: null, ibsStatePct: null, ibsMunicipalPct: null, status: 'PENDENTE', resolution: null, senateDeadline: '2028-10-31' },
  { year: 2030, cbsPct: null, ibsStatePct: null, ibsMunicipalPct: null, status: 'PENDENTE', resolution: null, senateDeadline: '2029-10-31' },
  { year: 2031, cbsPct: null, ibsStatePct: null, ibsMunicipalPct: null, status: 'PENDENTE', resolution: null, senateDeadline: '2030-10-31' },
  { year: 2032, cbsPct: null, ibsStatePct: null, ibsMunicipalPct: null, status: 'PENDENTE', resolution: null, senateDeadline: '2031-10-31' },
  { year: 2033, cbsPct: null, ibsStatePct: null, ibsMunicipalPct: null, status: 'PENDENTE', resolution: null, senateDeadline: '2032-10-31' },
];

export interface ReducedRateItem {
  annex: string;
  /** Redução das alíquotas de IBS e CBS, em %. */
  reductionPct: string;
  item: string;
  description: string;
  ncm: string[];
  /** Condição legal que o NCM sozinho não prova. */
  condition: string;
}

/** Únicos itens da LC 214 (Anexos I a XVI) com NCM de autopeças do Anexo II do Convênio 142/2018: acessórios para veículos de pessoas com deficiência. */
export const IBS_CBS_REDUCED_AUTOPECAS: ReducedRateItem[] = [
  { annex: 'V', reductionPct: '60', item: "1.1", description: "Comando de embreagem manual, suas partes e acessórios", ncm: ["8708.99.10"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.2", description: "Comando de freio manual, suas partes e acessórios", ncm: ["8708.99.10"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.3", description: "Comando de acelerador manual, suas partes e acessórios", ncm: ["8708.99.10"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.4", description: "Inversão do pedal do acelerador, suas partes e acessórios", ncm: ["8708.99.10"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.5", description: "Prolongamento de pedais, suas partes e acessórios", ncm: ["8708.99.10"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.6", description: "Empunhadura, suas partes e acessórios", ncm: ["8708.29.99"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.7", description: "Servo acionadores de volante, suas partes e acessórios", ncm: ["8708.99.10"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.8", description: "Deslocamento de comandos do painel, suas partes e acessórios", ncm: ["8708.29.99"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.9", description: "Plataforma giratória para deslocamento giratório do assento de veículo, suas partes e acessórios", ncm: ["8708.29.99"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.10", description: "Trilho elétrico para deslocamento do assento dianteiro para outra parte do interior do veículo, suas partes e acessórios", ncm: ["8708.29.99"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
  { annex: 'V', reductionPct: '60', item: "1.12", description: "Rampa para cadeira de rodas, suas partes e acessórios", ncm: ["8708.29.99"], condition: 'Acessórios e adaptações especiais para veículos automotores pertencentes ou destinados a pessoas com deficiência física (Anexo V, item 1)' },
];

export const IBS_CBS_REFERENCE_META: TableMeta = {
  id: 'ibs-cbs-referencia',
  version: '2026-10-13.1',
  effectiveFrom: '2027-01-01',
  effectiveTo: null,
  sources: [{ law: 'LC 214/2025 (com a LC 227/2026), arts. 349 a 359 e Anexos I a XVI', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm', retrievedAt: '2026-10-13' }],
  validatedBy: null,
  caveats: [
    'Em 2026-10-13 nenhuma alíquota de referência estava fixada: o TCU envia os cálculos ao Senado e o Senado fixa por resolução. Esta tabela só guarda o rito e o prazo; preencher quando a resolução sair.',
    'Peça comum de autopeça não consta de nenhum anexo de redução da LC 214: segue a alíquota padrão (regime geral).',
    'O levantamento por NCM cobre os Anexos I a XVI com o texto lido; não cobre regimes específicos, Imposto Seletivo, zona franca nem os cClassTrib da NF-e (tabela da Nota Técnica, não lida).',
    'Para as faixas 2029 a 2033 a lei também fixa redutores e limites (arts. 361 a 365, Anexo XVI) que não estão modelados.',
  ],
};
