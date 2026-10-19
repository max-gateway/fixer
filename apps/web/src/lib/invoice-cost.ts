// Custo real da compra (livro de custo da API, docs/specs/pricing.md §5.1). Decimais chegam como string no JSON.

export type CostTreatment = 'COST' | 'CREDIT' | 'INFO';

export type CostComponentCode =
  | 'PRODUTO'
  | 'DESCONTO'
  | 'FRETE'
  | 'FRETE_POR_FORA'
  | 'SEGURO'
  | 'OUTRAS_DESPESAS'
  | 'IPI'
  | 'ICMS_ST'
  | 'FCP_ST'
  | 'CREDITO_ICMS'
  | 'ICMS_PROPRIO'
  | 'ICMS_ST_RETIDO'
  | 'ICMS_DESONERADO'
  | 'PIS'
  | 'COFINS'
  | 'ICMS_ST_ENTRADA'
  | 'ANTECIPACAO_ICMS';

export type CostComponent = {
  code: CostComponentCode;
  treatment: CostTreatment;
  amount: string;
  source: string;
  allocated: boolean;
};

export type ItemCost = {
  /** Custo por unidade de estoque; null quando a quantidade é zero. */
  landed: string | null;
  total: string;
  profile: 'RESALE' | 'NOT_RESALE' | 'UNKNOWN';
  components: CostComponent[];
};

export type CostAlert = {
  code: string;
  severity: 'warning' | 'info';
  message: string;
  itemNumbers: number[];
  /** Valor a pagar anunciado (imposto de entrada em PE), em reais; ausente nos demais alertas. */
  amount?: string;
};

/** Nome de cada componente em linguagem de balcão, com o que ele significa para o custo. */
export const COMPONENT_LABEL: Record<CostComponentCode, string> = {
  PRODUTO: 'Produtos',
  DESCONTO: 'Desconto',
  FRETE: 'Frete',
  FRETE_POR_FORA: 'Frete por fora (informado por você)',
  SEGURO: 'Seguro',
  OUTRAS_DESPESAS: 'Outras despesas',
  IPI: 'IPI (não recuperável)',
  ICMS_ST: 'ICMS-ST',
  FCP_ST: 'FCP-ST',
  CREDITO_ICMS: 'Crédito de ICMS (abate o custo)',
  ICMS_PROPRIO: 'ICMS destacado (já está no preço)',
  ICMS_ST_RETIDO: 'ICMS-ST já retido antes (não entra)',
  ICMS_DESONERADO: 'ICMS desonerado',
  PIS: 'PIS do fornecedor (já está no preço)',
  COFINS: 'COFINS do fornecedor (já está no preço)',
  ICMS_ST_ENTRADA: 'ICMS-ST pago por você na entrada (PE)',
  ANTECIPACAO_ICMS: 'ICMS antecipado na entrada (PE, estimado)',
};

export type WithCost<T> = T & { cost?: ItemCost | null };
export type WithCostAlerts = { costAlerts?: CostAlert[] };
