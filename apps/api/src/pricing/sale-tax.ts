import { Prisma } from '@fixer/db';
import { MONOFASICO_AUTOPECAS_META, inForce, parseCents, presumidoCommerce, simplesBracketFor, simplesPeriodFor, simplesRate } from '@fixer/tax-rules';

// Imposto sobre a venda (docs/specs/pricing.md §5.2): o percentual do PREÇO que vai para tributo, que o cálculo do preço
// deduz antes da margem. Hoje só o Simples Nacional. A alíquota efetiva e a repartição vêm do Anexo I (packages/tax-rules,
// docs/specs/tax-rules.md) a partir da RBT12 do perfil; percentuais informados pelo contador no perfil valem mais que a
// tabela. O que o sistema decide sozinho é QUAIS parcelas saem (ICMS já recolhido por ST, PIS/COFINS monofásico), a
// partir da evidência do XML ou do enquadramento da peça.

type D = Prisma.Decimal;
type Value = Prisma.Decimal.Value | null | undefined;
const D = (v: Value): D => new Prisma.Decimal(v ?? 0);

export type Regime = 'SIMPLES' | 'PRESUMIDO' | 'REAL';

export interface TaxProfileInput {
  /** Alíquota efetiva do Simples sobre receita de comércio, em %. */
  simplesEffectiveRatePct: Value;
  /** Quanto da alíquota efetiva é ICMS, PIS e COFINS (em % da própria alíquota efetiva), segundo a repartição do contador. */
  icmsSharePct: Value;
  pisSharePct: Value;
  cofinsSharePct: Value;
  /** Receita bruta dos últimos 12 meses, em reais; com ela a alíquota e a repartição vêm da tabela do Anexo I. */
  rbt12?: Value;
  /** Lucro Presumido: alíquota de ICMS que a oficina cobra na venda (estadual; não vem de tabela). */
  icmsSalePct?: Value;
  reviewed: boolean;
}

export interface SaleTaxFlags {
  /** O ICMS desta peça já foi recolhido por substituição tributária (cobrado na compra ou retido antes). */
  icmsStDone: boolean;
  /** PIS/COFINS monofásicos: o revendedor tributa a alíquota zero. */
  monofasico: boolean;
  /** O enquadramento foi confirmado pela pessoa (ou a peça está com dado fiscal verificado), não é só leitura do XML. */
  confirmed: boolean;
}

export interface SaleTaxComponent {
  code: 'ICMS' | 'PIS' | 'COFINS' | 'CBS' | 'IBS' | 'IRPJ' | 'CSLL' | 'OUTROS' | 'DEFINIDO';
  pct: string;
  /** Em linguagem de balcão: por que este componente vale isso. */
  reason: string;
}

export type SaleTaxUnavailable =
  | 'REGIME_NAO_SUPORTADO'
  | 'SEM_ALIQUOTA'
  | 'REPARTICAO_FALTANDO'
  /** RBT12 acima do teto do Simples (R$ 4,8 milhões): o Anexo I não se aplica. */
  | 'RBT12_FORA_DO_SIMPLES'
  /** RBT12 acima do sublimite (R$ 3,6 milhões): ICMS e ISS saem do DAS e são pagos à parte, então a alíquota do Anexo I não vale. */
  | 'SUBLIMITE_ESTADUAL'
  /** A regra monofásica da Lei 10.485 deixa de valer em 2027-01-01; sem a tabela da reforma não há cálculo. */
  | 'REGRA_FORA_DE_VIGENCIA'
  /** PIS e Cofins acabaram em 2027 e as alíquotas de referência de CBS e IBS ainda não foram fixadas pelo Senado. */
  | 'REFORMA_SEM_ALIQUOTA';

export interface SaleTax {
  /** null quando não dá para calcular (sem sugestão de preço, a não ser que a oficina defina o percentual). */
  pct: D | null;
  components: SaleTaxComponent[];
  /** CONFIRMADO: enquadramento da peça e perfil validados. ESTIMADO: sugestão a partir do XML. DEFINIDO: percentual informado pela oficina. */
  confidence: 'CONFIRMADO' | 'ESTIMADO' | 'DEFINIDO';
  unavailable: SaleTaxUnavailable | null;
}

const fmt = (d: D) => d.toDecimalPlaces(4).toString();

/**
 * Tabelas de regra (packages/tax-rules) de que o cálculo depende neste caso. O imposto só sobe de "estimado" a "confirmado"
 * quando o contador validou TODAS elas na versão em uso (docs/specs/tax-rules.md §6).
 */
export function requiredTables(regime: Regime | null, flags: Pick<SaleTaxFlags, 'monofasico'>): string[] {
  const r = regime ?? 'SIMPLES';
  const tables = r === 'SIMPLES' ? ['simples-comercio'] : r === 'PRESUMIDO' ? ['federal-lucro'] : [];
  if (flags.monofasico) tables.push('monofasico-autopecas');
  return tables;
}

export interface SaleTaxInput {
  regime: Regime | null;
  profile: TaxProfileInput | null;
  flags: SaleTaxFlags;
  override: Value | null;
  asOf?: string;
  /** O contador validou, na versão em uso, todas as `requiredTables` deste caso. Sem isso o imposto fica "estimado". */
  tablesReviewed?: boolean;
  /**
   * Lucro Presumido: receita já fechada no trimestre-calendário em curso (OS concluídas no Fixer). A presunção sobe 10% só sobre o
   * que passa de R$ 1,25 milhão no trimestre (IN RFB 2.305/2025, art. 15), então o preço de uma venda nova usa o acréscimo se o
   * trimestre já passou do limite. Sem o dado (null/undefined), vale o teto antigo: acréscimo se a RBT12 passa de R$ 5 milhões.
   */
  quarterRevenue?: Value;
}

export function saleTax(input: SaleTaxInput): SaleTax {
  if (input.override !== null && input.override !== undefined) {
    const pct = D(input.override);
    return { pct, components: [{ code: 'DEFINIDO', pct: fmt(pct), reason: 'Percentual de imposto definido por você na regra de preço.' }], confidence: 'DEFINIDO', unavailable: null };
  }
  const none = (unavailable: SaleTaxUnavailable): SaleTax => ({ pct: null, components: [], confidence: 'ESTIMADO', unavailable });
  // Sem regime informado, o resto do sistema assume Simples (nfe-import §8.3): aqui também.
  const regime = input.regime ?? 'SIMPLES';
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  // Lucro Real: IRPJ e CSLL incidem sobre o lucro e PIS/Cofins admitem crédito sobre a compra; não há percentual da venda.
  if (regime === 'REAL') return none('REGIME_NAO_SUPORTADO');
  if (regime === 'PRESUMIDO') return presumidoTax(input.profile, input.flags, asOf, none, input.tablesReviewed === true, input.quarterRevenue);
  const p = input.profile;
  if (input.flags.monofasico && !inForce(MONOFASICO_AUTOPECAS_META, asOf)) return none('REGRA_FORA_DE_VIGENCIA');

  // Alíquota e repartição: o que o contador informou vale mais; o que faltar vem do Anexo I (ou do XVIII, a partir de 2027)
  // pela RBT12, na data.
  const rbt = isMissing(p?.rbt12) ? null : parseCents(D(p!.rbt12).toFixed(2));
  const manualRate = !isMissing(p?.simplesEffectiveRatePct);
  const bracket = rbt === null ? null : simplesBracketFor(rbt, asOf);
  if (rbt !== null && !bracket && !manualRate && simplesPeriodFor(asOf)) return none('RBT12_FORA_DO_SIMPLES');
  // Acima do sublimite (LC 123, art. 19, I e art. 13-A) o ICMS e o ISS são recolhidos fora do DAS, pelas regras gerais: a
  // alíquota do Anexo I incluiria um ICMS que a empresa não paga ali, e o ICMS real ficaria fora do preço. Alguns estados adotam
  // sublimite menor que R$ 3,6 milhões; o teto geral é o único que o Fixer conhece sem configuração por UF.
  if (rbt !== null && bracket && rbt > SUBLIMITE_CENTS && !manualRate && simplesPeriodFor(asOf)) return none('SUBLIMITE_ESTADUAL');
  const table = rbt === null || !bracket ? null : simplesRate(D(p!.rbt12).toFixed(2), asOf);
  const effectiveRaw = manualRate ? p!.simplesEffectiveRatePct : table?.effectivePct;
  if (!p || isMissing(effectiveRaw)) return none('SEM_ALIQUOTA');
  // A tabela só fornece repartição quando a alíquota efetiva também é a dela; misturar alíquota do contador com a
  // repartição da lei seria dado de duas origens.
  const fromTable = (pick: (s: NonNullable<typeof bracket>['share']) => string) => (!manualRate && bracket ? pick(bracket.share) : undefined);
  const shareOf = (manual: Value, tableValue: string | undefined) => (isMissing(manual) ? tableValue : manual);
  const icmsShare = shareOf(p.icmsSharePct, fromTable((x) => x.icms));
  const pisShare = shareOf(p.pisSharePct, fromTable((x) => x.pis));
  const cofinsShare = shareOf(p.cofinsSharePct, fromTable((x) => x.cofins));
  const cbsShare = fromTable((x) => x.cbs);
  const ibsShare = fromTable((x) => x.ibs);

  const effective = D(effectiveRaw);
  const share = (pctOfEffective: Value) => effective.mul(D(pctOfEffective)).div(100);
  const icms = share(icmsShare);
  const pis = share(pisShare);
  const cofins = share(cofinsShare);
  const cbs = share(cbsShare);
  const ibs = share(ibsShare);
  const others = effective.minus(icms).minus(pis).minus(cofins).minus(cbs).minus(ibs);

  const needsShares = (input.flags.icmsStDone && isMissing(icmsShare)) || (input.flags.monofasico && (isMissing(pisShare) || isMissing(cofinsShare)));
  if (needsShares) return none('REPARTICAO_FALTANDO');

  const components: SaleTaxComponent[] = [];
  let pct = effective;
  const line = (code: SaleTaxComponent['code'], value: D, zero: boolean, on: string, off: string) => {
    if (zero) pct = pct.minus(value);
    components.push({ code, pct: fmt(zero ? D(0) : value), reason: zero ? on : off });
  };
  line('ICMS', icms, input.flags.icmsStDone, 'ICMS 0%: já recolhido por substituição tributária; a receita sai da base do ICMS no Simples.', 'ICMS dentro da alíquota efetiva do Simples.');
  // PIS e Cofins só aparecem enquanto existem (até 2026); a partir de 2027 o Anexo XVIII traz CBS e IBS no lugar.
  if (!pis.isZero() || input.flags.monofasico) line('PIS', pis, input.flags.monofasico, 'PIS 0%: peça com tributação monofásica; a receita é segregada no Simples.', 'PIS dentro da alíquota efetiva do Simples.');
  if (!cofins.isZero() || input.flags.monofasico) line('COFINS', cofins, input.flags.monofasico, 'COFINS 0%: peça com tributação monofásica; a receita é segregada no Simples.', 'COFINS dentro da alíquota efetiva do Simples.');
  if (!cbs.isZero()) components.push({ code: 'CBS', pct: fmt(cbs), reason: 'CBS dentro da alíquota efetiva do Simples (LC 214/2025, Anexo XVIII), no lugar de PIS e Cofins.' });
  if (!ibs.isZero()) components.push({ code: 'IBS', pct: fmt(ibs), reason: 'IBS dentro da alíquota efetiva do Simples (LC 214/2025, Anexo XVIII); cresce enquanto o ICMS some, até 2033.' });
  components.push({ code: 'OUTROS', pct: fmt(others), reason: 'Demais tributos da alíquota efetiva do Simples (IRPJ, CSLL, CPP).' });

  return { pct, components, confidence: input.flags.confirmed && p.reviewed && input.tablesReviewed === true ? 'CONFIRMADO' : 'ESTIMADO', unavailable: null };
}

/** Limite trimestral da majoração do Presumido, em reais (IN RFB 2.305/2025, art. 15, § 2º). */
const QUARTER_LIMIT = 1_250_000;

/** R$ 3.600.000,00 em centavos. */
const SUBLIMITE_CENTS = 360_000_000n;

const isMissing = (v: Value) => v === null || v === undefined;

/**
 * Lucro Presumido, comércio: IRPJ e CSLL pela base presumida, PIS e Cofins cumulativos (zero se monofásico) e o ICMS da
 * venda (zero se já recolhido por ST). O adicional do IRPJ depende do lucro do período e não entra no preço.
 */
function presumidoTax(profile: TaxProfileInput | null, flags: SaleTaxFlags, asOf: string, none: (u: SaleTaxUnavailable) => SaleTax, tablesReviewed: boolean, quarterRevenue?: Value): SaleTax {
  // Venda nova = receita marginal: com o trimestre já acima de R$ 1,25 milhão ela é toda excedente; abaixo, não (só a venda que cruza o
  // limite erra, e por pouco). Sem a receita do trimestre, cai no teto antigo pela RBT12.
  const surcharge = !isMissing(quarterRevenue) ? D(quarterRevenue).gte(QUARTER_LIMIT) : !isMissing(profile?.rbt12) && D(profile!.rbt12).gt(5_000_000);
  const pc = presumidoCommerce(asOf, surcharge);
  // 2027 em diante: PIS/Cofins somem e CBS/IBS dependem das alíquotas de referência, que o Senado ainda não fixou.
  if (pc.pisCofinsExtinct) return none('REFORMA_SEM_ALIQUOTA');
  if (!flags.icmsStDone && isMissing(profile?.icmsSalePct)) return none('SEM_ALIQUOTA');

  const components: SaleTaxComponent[] = [];
  let pct = D(0);
  const add = (code: SaleTaxComponent['code'], value: D, zeroReason: string | null, reason: string) => {
    const zero = zeroReason !== null;
    if (!zero) pct = pct.plus(value);
    components.push({ code, pct: fmt(zero ? D(0) : value), reason: zero ? zeroReason : reason });
  };
  add('IRPJ', D(pc.irpjPct), null, 'IRPJ sobre a base presumida de 8% da receita (alíquota de 15%). O adicional de 10% depende do lucro do período e não entra no preço.');
  add('CSLL', D(pc.csllPct), null, 'CSLL sobre a base presumida de 12% da receita (alíquota de 9%).');
  add('PIS', D(pc.pisPct), flags.monofasico ? 'PIS 0%: peça com tributação monofásica.' : null, 'PIS cumulativo de 0,65% sobre a receita.');
  add('COFINS', D(pc.cofinsPct), flags.monofasico ? 'COFINS 0%: peça com tributação monofásica.' : null, 'COFINS cumulativa de 3% sobre a receita.');
  add('ICMS', D(profile?.icmsSalePct), flags.icmsStDone ? 'ICMS 0%: já recolhido por substituição tributária.' : null, 'ICMS da venda, na alíquota informada nas configurações.');

  return { pct, components, confidence: flags.confirmed && profile?.reviewed && tablesReviewed ? 'CONFIRMADO' : 'ESTIMADO', unavailable: null };
}
