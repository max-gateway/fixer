import { Prisma } from '@fixer/db';
import { cfopProfile, icmsCreditAllowed, isStPaidBefore, TAX_RULES_VERSION, type CfopProfile } from './rules.js';

// Livro de custo da compra (docs/specs/pricing.md §5.1): decompõe o que a nota realmente custou em componentes
// auditáveis e devolve o custo líquido de reposição por unidade de ESTOQUE. É a fonte única do custo exibido e do
// custo gravado em `Part.costPrice` (D10); o `unitCost()` isolado é o caso particular "Simples, sem FCP-ST e sem
// rateio" deste cálculo (há um teste de equivalência).

type D = Prisma.Decimal;
type Value = Prisma.Decimal.Value | null | undefined;
const D = (v: Value): D => new Prisma.Decimal(v ?? 0);

export type Regime = 'SIMPLES' | 'PRESUMIDO' | 'REAL';

/** COST soma ao custo, CREDIT abate (tributo recuperável) e INFO só é exibido. */
export type Treatment = 'COST' | 'CREDIT' | 'INFO';

export type ComponentCode =
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
  | 'COFINS';

export interface CostComponent {
  code: ComponentCode;
  treatment: Treatment;
  /** COST: com sinal (o desconto é negativo). CREDIT e INFO: valor positivo. */
  amount: D;
  /** Campo do XML de onde veio, ou MANUAL. */
  source: string;
  /** Veio do total da nota (ou de um valor manual) e foi rateado entre os itens. */
  allocated: boolean;
}

export interface LedgerItemInput {
  itemNumber: number;
  quantity: Value;
  totalPrice: Value;
  discount: Value;
  freight: Value;
  insurance: Value;
  otherCosts: Value;
  ipi: Value;
  icmsSt: Value;
  cfop: string;
  unitFactor: Value;
  tax?: {
    indTot?: number | null;
    icmsKind?: string | null;
    icmsCode?: string | null;
    icms?: Value;
    icmsSt?: Value;
    fcpSt?: Value;
    stRet?: Value;
    fcpStRet?: Value;
    deson?: Value;
    creditSn?: Value;
    pis?: Value;
    cofins?: Value;
  } | null;
}

export interface LedgerInvoiceInput {
  destIndicator?: number | null;
  freightMode?: number | null;
  /** ICMSTot do XML (vDesc, vFrete, vSeg, vOutro...) como string decimal. */
  totals?: unknown;
  extraFreight?: Value;
}

export type AlertCode =
  | 'REGIME_NAO_INFORMADO'
  | 'FRETE_POR_FORA'
  | 'ANTECIPACAO_ICMS_POSSIVEL'
  | 'NAO_E_COMPRA_REVENDA'
  | 'ITEM_FORA_DO_TOTAL'
  | 'TOTAIS_DIVERGENTES';

export interface LedgerAlert {
  code: AlertCode;
  severity: 'warning' | 'info';
  message: string;
  /** Itens envolvidos; vazio quando o alerta é da nota inteira. */
  itemNumbers: number[];
}

export interface ItemLedger {
  itemNumber: number;
  components: CostComponent[];
  /** Σ COST − Σ CREDIT, da linha inteira. */
  totalCost: D;
  /** Quantidade × fator de unidade: o que entra no estoque. */
  stockQty: D;
  /** Custo por unidade de estoque (4 casas); null quando a quantidade é zero. */
  landedCost: D | null;
  profile: CfopProfile;
}

export interface InvoiceLedger {
  items: Map<number, ItemLedger>;
  alerts: LedgerAlert[];
  regime: Regime;
  rulesVersion: string;
}

const ZERO = new Prisma.Decimal(0);
const EPSILON = new Prisma.Decimal('0.005');

/** Campos de despesa do item e a chave correspondente em ICMSTot. */
const ALLOCATED_FIELDS = [
  { field: 'discount', total: 'vDesc', code: 'DESCONTO', sign: -1 },
  { field: 'freight', total: 'vFrete', code: 'FRETE', sign: 1 },
  { field: 'insurance', total: 'vSeg', code: 'SEGURO', sign: 1 },
  { field: 'otherCosts', total: 'vOutro', code: 'OUTRAS_DESPESAS', sign: 1 },
] as const satisfies readonly { field: keyof LedgerItemInput; total: string; code: ComponentCode; sign: 1 | -1 }[];

/**
 * Rateia `amount` entre os itens proporcionalmente ao peso, em centavos exatos: a soma das partes é igual a
 * `amount`, e o resto de centavos vai para o item de maior peso.
 */
export function allocateByValue(amount: D, weights: { key: number; weight: D }[]): Map<number, D> {
  const out = new Map<number, D>();
  const total = weights.reduce((s, w) => s.plus(w.weight), ZERO);
  if (amount.lte(0) || total.lte(0)) return out;
  let given = ZERO;
  let biggest = weights[0]!;
  for (const w of weights) {
    const share = amount.mul(w.weight).div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    out.set(w.key, share);
    given = given.plus(share);
    if (w.weight.gt(biggest.weight)) biggest = w;
  }
  const rest = amount.minus(given);
  if (!rest.isZero()) out.set(biggest.key, out.get(biggest.key)!.plus(rest));
  return out;
}

function totalsOf(raw: unknown): Record<string, string> {
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
}

export function computeLedger(input: { invoice: LedgerInvoiceInput; items: LedgerItemInput[]; regime: Regime | null }): InvoiceLedger {
  const { invoice, items } = input;
  const regime: Regime = input.regime ?? 'SIMPLES';
  const totals = totalsOf(invoice.totals);
  const alerts: LedgerAlert[] = [];
  if (input.regime === null) {
    alerts.push({
      code: 'REGIME_NAO_INFORMADO',
      severity: 'warning',
      message: 'O regime tributário da oficina não foi informado: o custo foi calculado como Simples Nacional (sem crédito de impostos).',
      itemNumbers: [],
    });
  }

  // Itens fora do total da nota (indTot = 0) não recebem rateio.
  const offTotal = items.filter((i) => i.tax?.indTot === 0).map((i) => i.itemNumber);
  const weights = items.filter((i) => i.tax?.indTot !== 0).map((i) => ({ key: i.itemNumber, weight: D(i.totalPrice) }));

  // Despesas informadas só no total da nota: a diferença para a soma dos itens é rateada.
  const allocations = new Map<string, Map<number, D>>();
  const allocatedKeys: string[] = [];
  const excessKeys: string[] = [];
  for (const f of ALLOCATED_FIELDS) {
    const raw = totals[f.total];
    if (typeof raw !== 'string') continue;
    const sum = items.reduce((s, i) => s.plus(D(i[f.field] as Value)), ZERO);
    const diff = D(raw).minus(sum);
    if (diff.gt(EPSILON)) {
      allocations.set(f.field, allocateByValue(diff, weights));
      allocatedKeys.push(f.total);
    } else if (diff.lt(EPSILON.neg())) {
      excessKeys.push(f.total);
    }
  }
  const extra = D(invoice.extraFreight);
  const extraAlloc = extra.gt(0) ? allocateByValue(extra, weights) : new Map<number, D>();

  if (allocatedKeys.length > 0) {
    alerts.push({
      code: 'TOTAIS_DIVERGENTES',
      severity: 'info',
      message: `A nota informa ${allocatedKeys.join(', ')} só no total (ou acima da soma dos itens): a diferença foi rateada entre os itens pelo valor dos produtos.`,
      itemNumbers: [],
    });
  }
  if (excessKeys.length > 0) {
    alerts.push({
      code: 'TOTAIS_DIVERGENTES',
      severity: 'warning',
      message: `A soma dos itens passa do total informado na nota (${excessKeys.join(', ')}). Confira o XML; o custo usa os valores dos itens.`,
      itemNumbers: [],
    });
  }

  const ledgers = new Map<number, ItemLedger>();
  const notResale: number[] = [];
  const interstate: number[] = [];

  for (const item of items) {
    const tax = item.tax ?? null;
    const profile = cfopProfile(item.cfop);
    if (profile === 'NOT_RESALE') notResale.push(item.itemNumber);
    const components: CostComponent[] = [];
    const add = (code: ComponentCode, treatment: Treatment, amount: D, source: string, allocated = false) => {
      if (!amount.isZero()) components.push({ code, treatment, amount, source, allocated });
    };

    add('PRODUTO', 'COST', D(item.totalPrice), 'vProd');
    for (const f of ALLOCATED_FIELDS) {
      add(f.code, 'COST', D(item[f.field] as Value).mul(f.sign), f.total);
      add(f.code, 'COST', (allocations.get(f.field)?.get(item.itemNumber) ?? ZERO).mul(f.sign), `total/${f.total}`, true);
    }
    add('FRETE_POR_FORA', 'COST', extraAlloc.get(item.itemNumber) ?? ZERO, 'MANUAL', true);
    add('IPI', 'COST', D(item.ipi), 'vIPI');
    add('ICMS_ST', 'COST', D(tax?.icmsSt ?? item.icmsSt), 'vICMSST');
    add('FCP_ST', 'COST', D(tax?.fcpSt), 'vFCPST');

    add('ICMS_ST_RETIDO', 'INFO', D(tax?.stRet).plus(D(tax?.fcpStRet)), 'vICMSSTRet');
    add('ICMS_DESONERADO', 'INFO', D(tax?.deson), 'vICMSDeson');
    add('PIS', 'INFO', D(tax?.pis), 'vPIS');
    add('COFINS', 'INFO', D(tax?.cofins), 'vCOFINS');

    // ICMS próprio: só vira crédito para comprador fora do Simples, em compra para revenda. Emitente do Simples
    // (CSOSN) só transfere o crédito de `vCredICMSSN`; os demais, o `vICMS` destacado.
    const kind = tax?.icmsKind === 'CST' || tax?.icmsKind === 'CSOSN' ? tax.icmsKind : null;
    const code = tax?.icmsCode ?? null;
    let credit = ZERO;
    let creditSource = 'vICMS';
    if (regime !== 'SIMPLES' && profile !== 'NOT_RESALE' && icmsCreditAllowed(kind, code)) {
      credit = kind === 'CSOSN' ? D(tax?.creditSn) : D(tax?.icms);
      if (kind === 'CSOSN') creditSource = 'vCredICMSSN';
    }
    if (credit.gt(0)) add('CREDITO_ICMS', 'CREDIT', credit, creditSource);
    else add('ICMS_PROPRIO', 'INFO', D(tax?.icms), 'vICMS');

    const stCharged = D(tax?.icmsSt ?? item.icmsSt).plus(D(tax?.fcpSt)).gt(0);
    const stPaid = isStPaidBefore(kind, code) || D(tax?.stRet).gt(0);
    if (invoice.destIndicator === 2 && regime !== 'REAL' && profile !== 'NOT_RESALE' && tax?.indTot !== 0 && !stCharged && !stPaid) {
      interstate.push(item.itemNumber);
    }

    const stockQty = D(item.quantity).mul(D(item.unitFactor ?? 1));
    const totalCost = components.reduce((s, c) => (c.treatment === 'COST' ? s.plus(c.amount) : c.treatment === 'CREDIT' ? s.minus(c.amount) : s), ZERO);
    ledgers.set(item.itemNumber, {
      itemNumber: item.itemNumber,
      components,
      totalCost,
      stockQty,
      landedCost: stockQty.gt(0) ? totalCost.div(stockQty).toDecimalPlaces(4) : null,
      profile,
    });
  }

  if (invoice.freightMode === 1 && extra.isZero()) {
    alerts.push({
      code: 'FRETE_POR_FORA',
      severity: 'warning',
      message: 'O frete é por conta da oficina e não está nesta nota (vem em um CT-e à parte). O custo das peças não inclui o frete.',
      itemNumbers: [],
    });
  }
  if (interstate.length > 0) {
    alerts.push({
      code: 'ANTECIPACAO_ICMS_POSSIVEL',
      severity: 'warning',
      message: 'Compra de outra UF sem ICMS-ST na nota: alguns estados cobram antecipação ou diferencial de ICMS na entrada, que não está no XML. Confira com o contador.',
      itemNumbers: interstate,
    });
  }
  if (notResale.length > 0) {
    alerts.push({
      code: 'NAO_E_COMPRA_REVENDA',
      severity: 'warning',
      message: 'Estes itens não parecem compra para revenda (bonificação, amostra, conserto, consignação, transferência ou uso e consumo). Não use o custo deles para precificar.',
      itemNumbers: notResale,
    });
  }
  if (offTotal.length > 0) {
    alerts.push({ code: 'ITEM_FORA_DO_TOTAL', severity: 'info', message: 'Estes itens não compõem o total da nota (indTot = 0).', itemNumbers: offTotal });
  }

  return { items: ledgers, alerts, regime, rulesVersion: TAX_RULES_VERSION };
}
