// Despesas do perfil de custos publicado no cost-engine (docs/specs/cost-engine.md §14, fase 2), no formato que o plano de
// preço usa. Com perfil, elas substituem o `overheadPct` digitado na regra; sem perfil (motor desligado, nada publicado ou
// fora do ar), vale a regra, como sempre.

export type PricingCostProfile =
  | {
      status: 'OK';
      version: number;
      /** Canal do perfil usado para peças (o preço de venda da peça é um só, no balcão e na OS). */
      channel: string;
      /** % do preço: estrutura (despesa fixa rateada), despesas de venda e financeiro. */
      fixedPct: string;
      variablePct: string;
      financialPct: string;
      /** R$ por unidade somados ao custo (embalagem, tarifa por pedido ÷ itens por pedido). */
      extraUnitCost: string;
      confidence: 'CONFIRMADO' | 'ESTIMADO';
    }
  /** OFF: motor não configurado; NONE: nenhum perfil publicado; UNAVAILABLE: motor fora do ar (usa a regra e avisa). */
  | { status: 'OFF' | 'NONE' | 'UNAVAILABLE' };

export const NO_COST_PROFILE: PricingCostProfile = { status: 'OFF' };

/** Canal do modelo "oficina" cujos coeficientes valem para o preço da peça. */
export const PRICING_CHANNEL = 'BALCAO';
