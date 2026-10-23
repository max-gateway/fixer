import type { Regime } from './sale-tax.js';
import type { ProfileTrust, TableTrust, TrustBasis } from './tax-trust.js';

// O que falta para o imposto sobre a venda sair "confirmado" em vez de "estimado" (docs/specs/tax-rules.md §6). A tela de
// configuração mostra isto como um passo a passo: cada passo diz se está pronto e, se não, o que fazer.

export interface ReadinessStep {
  id: 'regime' | 'dados' | 'perfil' | 'tabela' | 'tabela-monofasico';
  label: string;
  done: boolean;
  /** O que falta ou o que está valendo, em linguagem de balcão. */
  detail: string;
  /** Não bloqueia o "pronto"; vale só para parte das peças. */
  optional?: boolean;
  /** Tabela de regra a que o passo se refere, quando for o caso. */
  tableId?: string;
  /** Quem garante o passo pronto: o contador ou a fonte oficial. */
  basis?: TrustBasis;
  /** Falta só o contador: os dados existem, mas não vieram de registro oficial. */
  needsAccountant?: boolean;
}

export interface TaxReadiness {
  regime: Regime;
  /** O regime veio das configurações fiscais; senão o sistema assume Simples. */
  regimeInformed: boolean;
  /** Lucro Real não tem percentual sobre a venda: o imposto depende de a oficina definir o percentual na regra. */
  supported: boolean;
  steps: ReadinessStep[];
  /** Tabelas que o cálculo deste regime usa (as monofásicas só valem para parte das peças). */
  requiredTables: string[];
  ready: boolean;
  summary: string;
}

/** Origem do valor principal do perfil (RBT12 no Simples, ICMS no Presumido), para explicar de onde ele veio. */
export interface ValueOrigin {
  source: string;
  confidence: string;
  reference: string | null;
}

export interface ReadinessInput {
  regime: Regime | null;
  profile: { rbt12: unknown; simplesEffectiveRatePct: unknown; icmsSalePct: unknown } | null;
  profileTrust: ProfileTrust;
  tables: ReadonlyMap<string, TableTrust>;
  origin?: ValueOrigin | null;
}

const REGIME_LABEL: Record<Regime, string> = { SIMPLES: 'Simples Nacional', PRESUMIDO: 'Lucro Presumido', REAL: 'Lucro Real' };
const TABLE_LABEL: Record<string, string> = { 'simples-comercio': 'tabela do Simples Nacional (Anexo I)', 'federal-lucro': 'tabela de tributos federais do Lucro Presumido', 'monofasico-autopecas': 'tabela de PIS/COFINS monofásico de autopeças' };
const PENDING_LABEL: Record<ProfileTrust['pending'][number], string> = {
  rbt12: 'a RBT12 não veio do PGDAS-D',
  simplesEffectiveRatePct: 'a alíquota efetiva foi digitada',
  icmsSalePct: 'o ICMS da venda não veio de fonte oficial',
  shares: 'a repartição dos tributos foi digitada',
};
const br = (iso: string) => iso.split('-').reverse().join('/');

/** De onde veio o valor, numa frase. */
export function originText(o: ValueOrigin | null | undefined): string {
  if (!o) return 'Informado.';
  const ref = o.reference ? ` (${o.reference})` : '';
  switch (o.source) {
    case 'INTEGRA_PGDASD':
      return `Da declaração do PGDAS-D na Receita${ref}.`;
    case 'FIXER_ESTIMATE':
      return `Estimada pelas ordens de serviço concluídas no Fixer${ref}.`;
    case 'TAX_RULES_DEFAULT':
      return `Alíquota padrão da UF${ref}.`;
    case 'MANUAL':
      return 'Informado por alguém da oficina.';
    default:
      return `Preenchido automaticamente${ref}.`;
  }
}

export function taxReadiness(input: ReadinessInput): TaxReadiness {
  const informed = input.regime !== null;
  const regime: Regime = input.regime ?? 'SIMPLES';
  const p = input.profile;
  const has = (v: unknown) => v !== null && v !== undefined;

  const steps: ReadinessStep[] = [
    {
      id: 'regime',
      label: 'Regime tributário da oficina',
      done: informed,
      detail: informed ? `${REGIME_LABEL[regime]}.` : 'Não identificado: o Fixer assume Simples Nacional até você responder qual é o regime.',
    },
  ];

  if (regime === 'REAL') {
    steps.push({ id: 'dados', label: 'Percentual de imposto', done: false, detail: 'No Lucro Real o imposto incide sobre o lucro e admite crédito: não existe percentual sobre a venda. Defina o percentual na regra de preço.' });
    return { regime, regimeInformed: informed, supported: false, steps, requiredTables: [], ready: false, summary: 'Lucro Real: o imposto não é calculado; defina o percentual na regra de preço.' };
  }

  const table = regime === 'SIMPLES' ? 'simples-comercio' : 'federal-lucro';
  let dataOk: boolean;
  if (regime === 'SIMPLES') {
    dataOk = has(p?.rbt12) || has(p?.simplesEffectiveRatePct);
    const detail = has(p?.rbt12)
      ? originText(input.origin)
      : has(p?.simplesEffectiveRatePct)
        ? 'Alíquota efetiva informada.'
        : 'Ainda sem a receita dos últimos 12 meses: o Fixer busca no PGDAS-D ou estima pelas ordens de serviço quando houver 12 meses de histórico.';
    steps.push({ id: 'dados', label: 'Receita dos últimos 12 meses (RBT12)', done: dataOk, detail });
  } else {
    dataOk = has(p?.icmsSalePct);
    steps.push({ id: 'dados', label: 'ICMS cobrado na venda', done: dataOk, detail: dataOk ? originText(input.origin) : 'Sem alíquota interna da UF no Fixer: informe a alíquota de ICMS que a oficina cobra.' });
  }

  const trust = input.profileTrust;
  steps.push({
    id: 'perfil',
    label: 'Conferência dos dados',
    done: trust.basis !== null,
    ...(trust.basis ? { basis: trust.basis } : {}),
    ...(trust.basis === null && dataOk ? { needsAccountant: true } : {}),
    detail:
      trust.basis === 'CONTADOR'
        ? 'Validados pelo contador. Mudar um valor pede nova validação.'
        : trust.basis === 'FONTE_OFICIAL'
          ? 'Dispensada: os valores vieram de registro oficial.'
          : dataOk
            ? `O contador precisa conferir: ${trust.pending.map((k) => PENDING_LABEL[k]).join('; ')}.`
            : 'Depende do passo anterior.',
  });

  const tableStep = (id: ReadinessStep['id'], tableId: string, optional: boolean): ReadinessStep => {
    const t = input.tables.get(tableId);
    return {
      id,
      tableId,
      optional,
      label: `Validação da ${TABLE_LABEL[tableId] ?? tableId}`,
      done: t?.basis != null,
      ...(t?.basis ? { basis: t.basis } : {}),
      detail:
        t?.basis === 'CONTADOR'
          ? 'Validada pelo contador na versão em uso.'
          : t?.basis === 'FONTE_OFICIAL'
            ? `Conferida automaticamente com o texto da lei em ${br(t.checkedAt!)}.`
            : t?.staleReview
              ? 'Validada numa versão anterior: a tabela mudou e ainda não foi conferida de novo.'
              : 'Ainda não conferida com a fonte oficial nem validada pelo contador.',
    };
  };
  steps.push(tableStep('tabela', table, false));
  steps.push({ ...tableStep('tabela-monofasico', 'monofasico-autopecas', true), label: 'Validação da tabela de monofásico (peças monofásicas)' });

  const missing = steps.filter((s) => !s.done && !s.optional);
  return {
    regime,
    regimeInformed: informed,
    supported: true,
    steps,
    requiredTables: [table, 'monofasico-autopecas'],
    ready: missing.length === 0,
    summary: missing.length === 0 ? 'Pronto: o imposto fica confirmado nas peças com enquadramento confirmado.' : `Imposto estimado. Falta: ${missing.map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1)).join('; ')}.`,
  };
}
