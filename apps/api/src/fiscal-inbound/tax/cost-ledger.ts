import { Prisma } from '@fixer/db';
import {
  cfopProfile,
  icmsCreditAllowed,
  interstateRate,
  isStPaidBefore,
  mvaAdjusted,
  ORIGIN_TAXED_AT_4,
  parseCents,
  PE_INTERNAL_RATE_PCT,
  PE_ST_AUTOPECAS_MVA,
  peAntecipacaoSimples,
  peStAutopecasOrigin,
  pePneuItem,
  stAutopecaCest,
  stAutopecaItems,
  TAX_RULES_VERSION,
  type CfopProfile,
} from './rules.js';

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
  | 'COFINS'
  /** ST que o adquirente em PE recolhe na entrada (autopeça de UF sem acordo): RICMS-PE, Anexo 37, art. 100. */
  | 'ICMS_ST_ENTRADA'
  /** Antecipação do ICMS na entrada do Simples em PE (mercadoria sem ST): RICMS-PE arts. 338 a 340 e 363-A. */
  | 'ANTECIPACAO_ICMS';

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
  ncm?: string | null;
  cest?: string | null;
  /** 1º dígito do CST (0 a 8). */
  origin?: number | null;
  tax?: {
    indTot?: number | null;
    icmsKind?: string | null;
    icmsCode?: string | null;
    icms?: Value;
    /** pICMS da operação própria do remetente. */
    icmsRate?: Value;
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
  issuerUf?: string | null;
  recipientUf?: string | null;
  issuedAt?: Date | null;
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
  | 'TOTAIS_DIVERGENTES'
  | 'ST_ENTRADA_PE'
  | 'ANTECIPACAO_PE';

export interface LedgerAlert {
  code: AlertCode;
  severity: 'warning' | 'info';
  message: string;
  /** Itens envolvidos; vazio quando o alerta é da nota inteira. */
  itemNumbers: number[];
  /** Valor a pagar que o alerta anuncia (imposto de entrada), em reais com 2 casas; ausente nos demais alertas. */
  amount?: string;
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

/** O que o livro de custo precisa saber da oficina compradora além do regime (regras de entrada da UF dela). */
export interface LedgerBuyer {
  /** Receita bruta dos últimos 12 meses, "1234567.89": decide ME × EPP na antecipação de PE. */
  rbt12?: string | null;
  /** Em dia com a SEFAZ estadual (PE: art. 393-A); null = não informado. */
  stateTaxRegular?: boolean | null;
}

const OPERATION_CODES: ReadonlySet<ComponentCode> = new Set(['PRODUTO', 'DESCONTO', 'FRETE', 'SEGURO', 'OUTRAS_DESPESAS', 'FRETE_POR_FORA', 'IPI']);
const INTER_PCTS = new Set(['4', '7', '12']);

/** Alíquota interestadual da operação: a destacada no XML quando é uma das três legais, senão a da Resolução do Senado. */
function interPctOf(item: LedgerItemInput, issuerUf: string, destUf: string): '4' | '7' | '12' | null {
  const fromXml = item.tax?.icmsRate == null ? null : D(item.tax.icmsRate).toNumber().toString();
  if (fromXml && INTER_PCTS.has(fromXml)) return fromXml as '4' | '7' | '12';
  return interstateRate(issuerUf, destUf, ORIGIN_TAXED_AT_4.has(String(item.origin ?? '')))?.pct ?? null;
}

const pctOf = (v: Value, pct: string) => D(v).mul(pct).div(100);
const brl = (v: D) => `R$ ${v.toFixed(2).replace('.', ',')}`;

export function computeLedger(input: { invoice: LedgerInvoiceInput; items: LedgerItemInput[]; regime: Regime | null; buyer?: LedgerBuyer }): InvoiceLedger {
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
  // Regras de entrada de PE: valem quando a nota é interestadual e o destinatário está em PE.
  const destUf = invoice.recipientUf?.toUpperCase() ?? null;
  const issuerUf = invoice.issuerUf?.toUpperCase() ?? null;
  const asOf = (invoice.issuedAt ?? new Date()).toISOString().slice(0, 10);
  const peEntry = invoice.destIndicator === 2 && destUf === 'PE' && issuerUf !== null && issuerUf !== 'PE';
  const stEntry = { items: [] as number[], total: ZERO, supplierShouldRetain: false, byNcmOnly: false, tyres: false };
  const antecipacao = { items: [] as number[], total: ZERO, assumptions: new Set<string>() };
  const rbt12Cents = input.buyer?.rbt12 ? parseCents(input.buyer.rbt12) : null;

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
    const owesOnEntry = profile !== 'NOT_RESALE' && tax?.indTot !== 0 && !stCharged && !stPaid;
    const autopeca = item.cest ? stAutopecaCest(item.cest) !== null : stAutopecaItems(item.ncm).length > 0;
    const pneu = autopeca ? null : pePneuItem(item.ncm, item.cest);
    const inter = peEntry && owesOnEntry ? interPctOf(item, issuerUf!, 'PE') : null;
    const operation = components.filter((c) => OPERATION_CODES.has(c.code)).reduce((s, c) => s.plus(c.amount), ZERO);
    // ST que a oficina recolhe na entrada em PE: base = operação × (1 + MVA ajustada); imposto = base × 20,5% − ICMS próprio.
    const stOnEntry = (mvaOriginal: string, source: string) => {
      const mva = mvaAdjusted(mvaOriginal, inter!, PE_INTERNAL_RATE_PCT);
      const notOwn = components.filter((c) => c.code === 'IPI' || c.code === 'FRETE_POR_FORA').reduce((s, c) => s.plus(c.amount), ZERO);
      const ownIcms = D(tax?.icms).gt(0) ? D(tax?.icms) : pctOf(operation.minus(notOwn), inter!);
      const due = pctOf(operation.mul(D(mva).div(100).plus(1)), PE_INTERNAL_RATE_PCT).minus(ownIcms).toDecimalPlaces(2);
      if (due.gt(0)) {
        add('ICMS_ST_ENTRADA', 'COST', due, `${source} (MVA ${mva}%)`);
        stEntry.items.push(item.itemNumber);
        stEntry.total = stEntry.total.plus(due);
      }
      return due.gt(0);
    };
    let handled = false;
    if (inter && autopeca) {
      // Autopeça (RICMS-PE, Anexo 37, art. 100; Prot. 97/2010): MVA de 71,78%.
      const origin = peStAutopecasOrigin(issuerUf!, asOf);
      if (origin.status === 'ADQUIRENTE_RECOLHE' || origin.status === 'REMETENTE_RETEM') {
        if (stOnEntry(PE_ST_AUTOPECAS_MVA.general, 'RICMS-PE Anexo 37 art. 100')) {
          if (origin.status === 'REMETENTE_RETEM') stEntry.supplierShouldRetain = true;
          if (!item.cest) stEntry.byNcmOnly = true;
        }
        handled = true;
      }
    } else if (inter && pneu) {
      // Pneu, câmara ou protetor (RICMS-PE, Anexo 37, arts. 49 a 54; Conv. 142/2018, Anexo XVI): MVA do item.
      if (stOnEntry(pneu.item.mvaOriginal, `RICMS-PE Anexo 37 arts. 49-54, item ${pneu.item.item}`)) {
        stEntry.tyres = true;
        if (pneu.byNcmOnly) stEntry.byNcmOnly = true;
      }
      handled = true;
    } else if (inter && regime === 'SIMPLES') {
      // Antecipação do Simples (mercadoria sem ST): percentual do informativo sobre o valor da operação (estimativa).
      const a = peAntecipacaoSimples({ rbt12Cents, regular: input.buyer?.stateTaxRegular ?? null, interPct: inter, asOf });
      const due = pctOf(operation, a.pct).toDecimalPlaces(2);
      if (due.gt(0)) {
        add('ANTECIPACAO_ICMS', 'COST', due, `RICMS-PE arts. 338-340 (${a.pct}%)`);
        antecipacao.items.push(item.itemNumber);
        antecipacao.total = antecipacao.total.plus(due);
        for (const x of a.assumptions) antecipacao.assumptions.add(x);
      }
      handled = true;
    }
    if (!handled && invoice.destIndicator === 2 && regime !== 'REAL' && owesOnEntry) {
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
  if (stEntry.items.length > 0) {
    alerts.push({
      code: 'ST_ENTRADA_PE',
      severity: 'warning',
      message:
        `Mercadoria com ST em PE comprada de outra UF sem ICMS-ST na nota: a oficina recolhe ${brl(stEntry.total)} de ST na entrada (RICMS-PE, Anexo 37, MVA ajustada). Já está no custo.` +
        (stEntry.supplierShouldRetain ? ' O fornecedor da autopeça é de UF do Protocolo 97/2010 e deveria ter retido: confira com ele, a SEFAZ-PE cobra de você.' : '') +
        (stEntry.tyres ? ' Pneu de fabricante ou importador costuma vir com a ST retida: confira a nota com o fornecedor.' : '') +
        (stEntry.byNcmOnly ? ' Item sem CEST enquadrado pelo NCM: confirme o enquadramento (uso automotivo, tipo de pneu).' : ''),
      itemNumbers: stEntry.items,
      amount: stEntry.total.toFixed(2),
    });
  }
  if (antecipacao.items.length > 0) {
    const why: string[] = [];
    if (antecipacao.assumptions.has('REGULARIDADE_NAO_INFORMADA')) why.push('a situação na SEFAZ-PE não foi informada, então usamos o percentual de contribuinte irregular (o maior)');
    if (antecipacao.assumptions.has('PORTE_PRESUMIDO')) why.push('sem a receita dos últimos 12 meses, usamos o percentual de EPP');
    if (antecipacao.assumptions.has('SEM_PERCENTUAL_NA_DATA')) why.push('não há percentual reduzido publicado para esta data');
    alerts.push({
      code: 'ANTECIPACAO_PE',
      severity: 'warning',
      message: `Compra de outra UF: estimamos ${brl(antecipacao.total)} de antecipação de ICMS na entrada em PE (Simples Nacional). Já está no custo; o valor exato vem no extrato da SEFAZ-PE.${why.length ? ` Atenção: ${why.join('; ')}.` : ''}`,
      itemNumbers: antecipacao.items,
      amount: antecipacao.total.toFixed(2),
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
