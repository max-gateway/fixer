import { Prisma } from '@fixer/db';

// Cálculo do preço de venda (docs/specs/pricing.md §5.3 e §5.4). Funções puras sobre Decimal: nada de I/O, nada de
// ponto flutuante. A API é a autoridade; a tela só repete a conta para mostrar o efeito de cada tecla.

type D = Prisma.Decimal;
type Value = Prisma.Decimal.Value | null | undefined;
const D = (v: Value): D => new Prisma.Decimal(v ?? 0);
const HUNDRED = new Prisma.Decimal(100);

export type PricingMethod = 'MARGIN' | 'MARKUP';
export type RoundingMode = 'NONE' | 'CENTS_90' | 'CENTS_00' | 'MULTIPLE_5' | 'MULTIPLE_10';

export interface PriceParams {
  method: PricingMethod;
  /** % de margem sobre a venda (MARGIN) ou de markup sobre o custo (MARKUP). */
  value: Value;
  /** % do preço que vai para imposto sobre a venda. */
  taxPct: Value;
  /** % do preço de despesa variável (taxa de cartão, comissão...). */
  overheadPct: Value;
  rounding: RoundingMode;
}

export class PricingError extends Error {}

/** Arredonda SEMPRE para cima: a margem pedida nunca fica abaixo do pedido por causa do arredondamento. */
export function roundPrice(price: Value, mode: RoundingMode): D {
  const p = D(price);
  switch (mode) {
    case 'NONE':
      return p.toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
    case 'CENTS_00':
      return p.ceil();
    case 'CENTS_90': {
      // menor valor da forma N,90 que não é menor que o preço
      const n = p.minus('0.9').ceil();
      return (n.isNegative() ? D(0) : n).plus('0.9');
    }
    case 'MULTIPLE_5':
      return p.div(5).ceil().mul(5);
    case 'MULTIPLE_10':
      return p.div(10).ceil().mul(10);
  }
}

const remaining = (parts: Value[]): D => HUNDRED.minus(parts.reduce<D>((s, v) => s.plus(D(v)), D(0)));

/** Preço antes do arredondamento. Lança PricingError se os percentuais somam 100% ou mais (divisão sem sentido). */
export function rawPrice(cost: Value, p: PriceParams): D {
  const c = D(cost);
  if (c.lte(0)) throw new PricingError('Custo precisa ser maior que zero');
  if (D(p.value).isNegative() || D(p.taxPct).isNegative() || D(p.overheadPct).isNegative()) throw new PricingError('Percentuais não podem ser negativos');
  if (p.method === 'MARGIN') {
    const room = remaining([p.value, p.taxPct, p.overheadPct]);
    if (room.lte(0)) throw new PricingError('Margem, imposto e despesas somam 100% ou mais: não há preço possível');
    return c.mul(HUNDRED).div(room);
  }
  const room = remaining([p.taxPct, p.overheadPct]);
  if (room.lte(0)) throw new PricingError('Imposto e despesas somam 100% ou mais: não há preço possível');
  return c.mul(HUNDRED.plus(D(p.value))).div(room);
}

export interface PriceResult {
  price: D;
  /** Margem líquida real (depois de imposto e despesas), calculada sobre o preço já arredondado, em %. */
  marginPct: D;
  markupPct: D;
}

/** Margem líquida em % sobre a venda: o que sobra do preço depois do imposto, das despesas e do custo. */
export function marginFromPrice(cost: Value, price: Value, taxPct: Value, overheadPct: Value): D {
  const pr = D(price);
  if (pr.lte(0)) return D(0);
  const net = pr.mul(remaining([taxPct, overheadPct])).div(HUNDRED);
  return net.minus(D(cost)).div(pr).mul(HUNDRED);
}

export const markupFromPrice = (cost: Value, price: Value): D => (D(cost).lte(0) ? D(0) : D(price).minus(D(cost)).div(D(cost)).mul(HUNDRED));

export function suggestPrice(cost: Value, p: PriceParams): PriceResult {
  const price = roundPrice(rawPrice(cost, p), p.rounding);
  return {
    price,
    marginPct: marginFromPrice(cost, price, p.taxPct, p.overheadPct),
    markupPct: markupFromPrice(cost, price),
  };
}

/** Preço que dá a margem líquida pedida (a edição "digitei a margem" da tela), já arredondado. */
export function priceFromMargin(cost: Value, marginPct: Value, taxPct: Value, overheadPct: Value, rounding: RoundingMode): D {
  return roundPrice(rawPrice(cost, { method: 'MARGIN', value: marginPct, taxPct, overheadPct, rounding }), rounding);
}

// ---- guardas (§5.4) ----

export type PriceFlag =
  | 'NO_RULE'
  | 'LOCKED'
  | 'NO_COST'
  | 'NOT_RESALE'
  | 'TAX_UNAVAILABLE'
  | 'TAX_UNCONFIRMED'
  | 'BELOW_COST'
  | 'BELOW_COST_AFTER_TAX'
  | 'BELOW_MIN_MARGIN'
  | 'BIG_JUMP'
  | 'COST_SPIKE'
  | 'PRICE_DOWN';

/** Bloqueiam o lançamento enquanto o preço estiver assim (não há "estou ciente" para prejuízo certo). */
export const BLOCKING_FLAGS: readonly PriceFlag[] = ['BELOW_COST', 'BELOW_COST_AFTER_TAX'];
/** Exigem que a pessoa marque "estou ciente" no item. */
export const ACK_FLAGS: readonly PriceFlag[] = ['BELOW_MIN_MARGIN', 'BIG_JUMP'];

export interface EvaluateInput {
  cost: D;
  /** Preço que vai valer (rascunho ou sugestão). */
  proposed: D;
  currentPrice: D | null;
  previousCost: D | null;
  taxPct: D;
  overheadPct: D;
  minMarginPct: D;
  maxJumpPct: D;
  taxConfirmed: boolean;
  requireTaxConfirmation: boolean;
}

export function evaluatePrice(i: EvaluateInput): PriceFlag[] {
  const flags: PriceFlag[] = [];
  if (i.proposed.lt(i.cost)) flags.push('BELOW_COST');
  // vende acima do custo, mas depois do imposto e das despesas não cobre o custo
  else if (i.proposed.mul(remaining([i.taxPct, i.overheadPct])).div(HUNDRED).lt(i.cost)) flags.push('BELOW_COST_AFTER_TAX');
  if (marginFromPrice(i.cost, i.proposed, i.taxPct, i.overheadPct).lt(i.minMarginPct)) flags.push('BELOW_MIN_MARGIN');
  if (i.currentPrice && i.currentPrice.gt(0)) {
    if (i.proposed.minus(i.currentPrice).abs().div(i.currentPrice).mul(HUNDRED).gt(i.maxJumpPct)) flags.push('BIG_JUMP');
    if (i.proposed.lt(i.currentPrice)) flags.push('PRICE_DOWN');
  }
  if (i.previousCost && i.previousCost.gt(0) && i.cost.minus(i.previousCost).div(i.previousCost).mul(HUNDRED).gt(i.maxJumpPct)) flags.push('COST_SPIKE');
  if (!i.taxConfirmed && i.requireTaxConfirmation) flags.push('TAX_UNCONFIRMED');
  return flags;
}

/** Flags que ainda impedem o lançamento, dado o "estou ciente" do item. */
export function blockingFlags(flags: readonly PriceFlag[], ack: boolean, requireTaxConfirmation: boolean): PriceFlag[] {
  return flags.filter(
    (f) => BLOCKING_FLAGS.includes(f) || (!ack && (ACK_FLAGS.includes(f) || (f === 'TAX_UNCONFIRMED' && requireTaxConfirmation))),
  );
}
