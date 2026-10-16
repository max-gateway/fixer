import type { Regime } from './sale-tax.js';

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

export interface ReadinessInput {
  regime: Regime | null;
  profile: { rbt12: unknown; simplesEffectiveRatePct: unknown; icmsSalePct: unknown; reviewedAt: Date | null } | null;
  /** `true` = o contador validou a versão em uso; `false` = validou outra versão; ausente = nunca validou. */
  tableReviews: ReadonlyMap<string, boolean>;
}

const REGIME_LABEL: Record<Regime, string> = { SIMPLES: 'Simples Nacional', PRESUMIDO: 'Lucro Presumido', REAL: 'Lucro Real' };
const TABLE_LABEL: Record<string, string> = { 'simples-comercio': 'tabela do Simples Nacional (Anexo I)', 'federal-lucro': 'tabela de tributos federais do Lucro Presumido', 'monofasico-autopecas': 'tabela de PIS/COFINS monofásico de autopeças' };

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
      detail: informed ? `${REGIME_LABEL[regime]}.` : 'Não informado: o Fixer assume Simples Nacional. Confirme em Dados fiscais da oficina.',
    },
  ];

  if (regime === 'REAL') {
    steps.push({ id: 'dados', label: 'Percentual de imposto', done: false, detail: 'No Lucro Real o imposto incide sobre o lucro e admite crédito: não existe percentual sobre a venda. Defina o percentual na regra de preço.' });
    return { regime, regimeInformed: informed, supported: false, steps, requiredTables: [], ready: false, summary: 'Lucro Real: o imposto não é calculado; defina o percentual na regra de preço.' };
  }

  const table = regime === 'SIMPLES' ? 'simples-comercio' : 'federal-lucro';
  if (regime === 'SIMPLES') {
    const ok = has(p?.rbt12) || has(p?.simplesEffectiveRatePct);
    steps.push({ id: 'dados', label: 'Receita dos últimos 12 meses (RBT12)', done: ok, detail: ok ? 'Informada.' : 'Informe a RBT12 do PGDAS-D: com ela o Fixer calcula a alíquota pelo Anexo I.' });
  } else {
    const ok = has(p?.icmsSalePct);
    steps.push({ id: 'dados', label: 'ICMS cobrado na venda', done: ok, detail: ok ? 'Informado.' : 'Informe a alíquota de ICMS que a sua oficina cobra: ela é estadual e não vem de tabela federal.' });
  }

  const reviewed = p?.reviewedAt != null;
  steps.push({ id: 'perfil', label: 'Dados validados pelo contador', done: reviewed, detail: reviewed ? 'Validados. Mudar um valor pede nova validação.' : 'O contador precisa conferir e validar os dados acima.' });

  const tableStep = (id: ReadinessStep['id'], tableId: string, optional: boolean): ReadinessStep => {
    const r = input.tableReviews.get(tableId);
    return {
      id,
      tableId,
      optional,
      label: `Validação da ${TABLE_LABEL[tableId] ?? tableId}`,
      done: r === true,
      detail: r === true ? 'Validada na versão em uso.' : r === false ? 'Validada numa versão anterior: a tabela mudou e precisa ser validada de novo.' : 'O contador ainda não validou esta tabela.',
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
