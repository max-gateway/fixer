// Jornada de configuração da oficina: o que cada etapa precisa para estar pronta, calculado só a partir do que a API já devolve.

import type { AutofillProvenance } from '@/lib/fiscal-autofill';
import { daysUntil, type FiscalStatus } from '@/lib/fiscal-import';
import type { FiscalSettings } from '../fiscal-settings-form';
import type { TaxSummary } from '../fiscal-overview';

export type StepId = 'certificado' | 'empresa' | 'impostos' | 'automacao' | 'pronto';

/** done = pronto; partial = funciona, mas tem algo para conferir; todo = falta a pessoa agir; locked = depende de uma etapa anterior. */
export type StepState = 'done' | 'partial' | 'todo' | 'locked';

export type JourneyStep = { id: StepId; title: string; summary: string; state: StepState };

export type JourneyInput = {
  status: FiscalStatus;
  fiscal: FiscalSettings | null;
  provenance: AutofillProvenance;
  /** null = sem permissão de precificação: a etapa de impostos olha só o regime. */
  tax: TaxSummary | null;
  now?: number;
};

/** As três automações da busca de notas, na ordem em que a nota passa por elas. */
export function automations(cred: FiscalStatus['credential']) {
  return { sync: Boolean(cred?.enabled), manifest: Boolean(cred?.autoManifest), stock: Boolean(cred?.autoExport) };
}

export function journeySteps({ status, fiscal, provenance, tax, now = Date.now() }: JourneyInput): JourneyStep[] {
  const cred = status.credential;
  const company = status.settings;
  const days = cred ? daysUntil(cred.notAfter, now) : null;

  const certificado: JourneyStep = !status.keyAvailable
    ? { id: 'certificado', title: 'Certificado digital', summary: 'Indisponível neste ambiente', state: 'locked' }
    : !cred
      ? { id: 'certificado', title: 'Certificado digital', summary: 'Envie o e-CNPJ A1 (.pfx)', state: 'todo' }
      : days! < 0
        ? { id: 'certificado', title: 'Certificado digital', summary: 'Vencido: envie o renovado', state: 'todo' }
        : days! <= 30
          ? { id: 'certificado', title: 'Certificado digital', summary: `Vence em ${days} ${days === 1 ? 'dia' : 'dias'}`, state: 'partial' }
          : { id: 'certificado', title: 'Certificado digital', summary: 'Válido e protegido', state: 'done' };

  const missingCompany = [!company?.legalName && 'razão social', !fiscal?.municipalityIbge && 'município', !fiscal?.cnae && 'atividade'].filter(Boolean);
  const empresa: JourneyStep = !company?.cnpj
    ? { id: 'empresa', title: 'Dados da empresa', summary: 'Vêm do certificado', state: 'locked' }
    : missingCompany.length > 0
      ? { id: 'empresa', title: 'Dados da empresa', summary: `Falta ${missingCompany.join(', ')}`, state: 'partial' }
      : { id: 'empresa', title: 'Dados da empresa', summary: 'Preenchidos pela Receita', state: 'done' };

  const readiness = tax?.readiness ?? null;
  const impostos: JourneyStep = !company?.cnpj
    ? { id: 'impostos', title: 'Impostos', summary: 'Vêm da Receita e da prefeitura', state: 'locked' }
    : !fiscal?.taxRegime
      ? { id: 'impostos', title: 'Impostos', summary: provenance.simplesOptant === false ? 'Confirme o regime' : 'Informe o regime', state: 'todo' }
      : readiness && !readiness.ready
        ? { id: 'impostos', title: 'Impostos', summary: 'Calculando com estimativa', state: 'partial' }
        : { id: 'impostos', title: 'Impostos', summary: 'Confirmados', state: 'done' };

  const on = automations(cred);
  const count = Number(on.sync) + Number(on.manifest) + Number(on.stock);
  const automacao: JourneyStep = !cred
    ? { id: 'automacao', title: 'Automações', summary: 'Ligadas com o certificado', state: 'locked' }
    : !on.sync
      ? { id: 'automacao', title: 'Automações', summary: 'Busca de notas desligada', state: 'todo' }
      : count < 3
        ? { id: 'automacao', title: 'Automações', summary: `${count} de 3 ligadas`, state: 'partial' }
        : { id: 'automacao', title: 'Automações', summary: 'Tudo no automático', state: 'done' };

  const before = [certificado, empresa, impostos, automacao];
  const pronto: JourneyStep = before.some((s) => s.state === 'todo' || s.state === 'locked')
    ? { id: 'pronto', title: 'Piloto automático', summary: 'Conclua as etapas acima', state: 'locked' }
    : { id: 'pronto', title: 'Piloto automático', summary: before.every((s) => s.state === 'done') ? 'Tudo funcionando sozinho' : 'Funcionando, com pontos a conferir', state: 'done' };

  return [...before, pronto];
}

/** Etapa que abre: a primeira que pede ação da pessoa; com tudo encaminhado, o cenário final. */
export function firstOpen(steps: JourneyStep[]): StepId {
  return steps.find((s) => s.state === 'todo')?.id ?? 'pronto';
}

/** Quanto da jornada está feito (0 a 1). `partial` conta como feito: já funciona sozinho. */
export function progress(steps: JourneyStep[]): number {
  const work = steps.filter((s) => s.id !== 'pronto');
  return work.filter((s) => s.state === 'done' || s.state === 'partial').length / work.length;
}
