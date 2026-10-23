// Percentuais de presunção do Lucro Presumido por atividade, em % da receita bruta. Lei 9.249/1995, art. 15 (IRPJ) e art. 20 (CSLL),
// texto compilado do Planalto lido em 2026-10-22. A majoração da LC 224/2025 (+10% relativo acima de R$ 5 milhões) está em
// `PRESUMIDO_SURCHARGE` (federal-lucro.ts) e vale para todas as linhas.

export type PresumidoActivity =
  | 'COMERCIO_INDUSTRIA' // revenda de mercadorias, indústria e demais atividades (art. 15, caput)
  | 'TRANSPORTE_CARGA' // art. 15, § 1º, II, a: transporte de carga fica no caput
  | 'SERVICOS_HOSPITALARES' // art. 15, § 1º, III, a (exceção do inciso): hospitalares e auxílio diagnóstico, com os requisitos da lei
  | 'COMBUSTIVEL_REVENDA' // art. 15, § 1º, I
  | 'TRANSPORTE_PASSAGEIROS' // art. 15, § 1º, II, a
  | 'SERVICOS' // art. 15, § 1º, III: serviços em geral, intermediação, administração/locação, factoring, infraestrutura de concessão
  | 'EMPRESA_SIMPLES_CREDITO'; // art. 15, § 1º, IV (LC 167/2019)

export interface PresumptionLine {
  activity: PresumidoActivity;
  /** % da receita bruta que vira base do IRPJ. */
  irpjPct: string;
  /** % da receita bruta que vira base da CSLL. */
  csllPct: string;
  source: string;
}

export const PRESUMPTION: PresumptionLine[] = [
  { activity: 'COMERCIO_INDUSTRIA', irpjPct: '8.00', csllPct: '12.00', source: 'Lei 9.249/1995, art. 15, caput, e art. 20, III' },
  { activity: 'TRANSPORTE_CARGA', irpjPct: '8.00', csllPct: '12.00', source: 'Lei 9.249/1995, art. 15, § 1º, II, a (carga fica no caput), e art. 20, III' },
  { activity: 'SERVICOS_HOSPITALARES', irpjPct: '8.00', csllPct: '12.00', source: 'Lei 9.249/1995, art. 15, § 1º, III, a (exceção para serviços hospitalares e de auxílio diagnóstico), e art. 20, III' },
  { activity: 'COMBUSTIVEL_REVENDA', irpjPct: '1.60', csllPct: '12.00', source: 'Lei 9.249/1995, art. 15, § 1º, I, e art. 20, III' },
  { activity: 'TRANSPORTE_PASSAGEIROS', irpjPct: '16.00', csllPct: '12.00', source: 'Lei 9.249/1995, art. 15, § 1º, II, a, e art. 20, III' },
  { activity: 'SERVICOS', irpjPct: '32.00', csllPct: '32.00', source: 'Lei 9.249/1995, art. 15, § 1º, III, e art. 20, I' },
  { activity: 'EMPRESA_SIMPLES_CREDITO', irpjPct: '38.40', csllPct: '38.40', source: 'Lei 9.249/1995, art. 15, § 1º, IV, e art. 20, II (LC 167/2019)' },
];
