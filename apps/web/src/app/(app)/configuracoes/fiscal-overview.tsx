'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Check, CircleAlert, CircleCheck, CircleDashed, HelpCircle, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { UF_CODES } from '@/lib/cnpj';
import { postJson, putJson } from '@/lib/client-api';
import { autofillNotices, provenanceTag, REGIME_LABEL, stepNotes, type AutofillProvenance, type AutofillReport } from '@/lib/fiscal-autofill';
import { formatCnpj, money } from '@/lib/invoices';
import { cn } from '@/lib/utils';
import type { FiscalSettings } from './fiscal-settings-form';
import type { TaxReadiness } from './precificacao/readiness';

export type TaxSummary = {
  profile: { rbt12: string | null; rbt12AsOf: string | null; icmsSalePct: string | null; stateTaxRegular?: boolean | null; requireTaxConfirmation?: boolean } | null;
  readiness: TaxReadiness;
};

type Props = {
  company: { cnpj: string; legalName: string | null; ufCode: number | null };
  fiscal: FiscalSettings | null;
  provenance: AutofillProvenance;
  /** null = sem permissão para ver a precificação (a parte do imposto fica de fora). */
  tax: TaxSummary | null;
  hasCredential: boolean;
  /** 'company' mostra só os dados da empresa (a parte tributária vive em /configuracoes/tributario). */
  scope?: 'all' | 'company';
  /** O selo de confiança do imposto já aparece em outro lugar da página. */
  hideStatus?: boolean;
  /** Alíquota de ISS da tabela municipal do motor, usada quando a prefeitura não informou. */
  issEngine?: string | null;
};

type State = 'ok' | 'estimated' | 'missing';
type Row = { label: string; value: ReactNode | null; state: State; note?: ReactNode };

const pct = (v: string | number) => `${String(Number(v)).replace('.', ',')}%`;
const STATE_ICON: Record<State, { icon: typeof CircleCheck; className: string; sr: string }> = {
  ok: { icon: CircleCheck, className: 'text-emerald-700', sr: 'pronto' },
  estimated: { icon: CircleAlert, className: 'text-amber-700', sr: 'estimado' },
  missing: { icon: CircleDashed, className: 'text-muted-foreground', sr: 'pendente' },
};

/**
 * Tudo o que o Fixer buscou sozinho a partir do certificado, de onde veio cada valor e o que ainda falta. É a resposta
 * para "por que o imposto ainda está estimado?": cada linha diz a fonte, e o que depende de alguém aparece como ação.
 */
export function FiscalOverview({ company, fiscal, provenance, tax, hasCredential, scope = 'all', hideStatus = false, issEngine = null }: Props) {
  const showTax = scope === 'all';
  const router = useRouter();
  const refresh = useMutation({
    mutationFn: () => postJson<AutofillReport>('/api/fiscal/autofill', {}, 'Não foi possível atualizar os dados agora.'),
    onSuccess: () => router.refresh(),
  });
  const notices = refresh.data ? [...autofillNotices(refresh.data), ...stepNotes(refresh.data)] : [];
  const prov = (field: string) => provenance.fields.find((f) => f.field === field);
  const from = (field: string, fallback: State = 'ok'): { state: State; note?: string } => {
    const tag = provenanceTag(prov(field));
    return tag ? { state: tag.estimated ? 'estimated' : fallback, note: tag.text } : { state: fallback };
  };

  const regime = fiscal?.taxRegime ?? null;
  const readiness = tax?.readiness ?? null;
  const step = (id: string) => readiness?.steps.find((s) => s.id === id);
  const uf = UF_CODES.find((u) => u.code === company.ufCode)?.sigla ?? null;

  const companyRows: Row[] = [
    { label: 'CNPJ', value: formatCnpj(company.cnpj), state: 'ok', note: hasCredential ? 'Do certificado digital' : undefined },
    { label: 'Razão social', value: company.legalName, state: company.legalName ? 'ok' : 'missing' },
    { label: 'UF', value: uf, state: uf ? 'ok' : 'missing' },
    { label: 'Município (IBGE)', value: fiscal?.municipalityIbge ?? null, ...(fiscal?.municipalityIbge ? from('municipalityIbge') : { state: 'missing' as const }) },
    { label: 'Atividade (CNAE)', value: fiscal?.cnae ? fiscal.cnae.replace(/^(\d{4})(\d)(\d{2})$/, '$1-$2/$3') : null, ...(fiscal?.cnae ? from('cnae') : { state: 'missing' as const }) },
  ];

  const taxRows: Row[] = [
    regime
      ? { label: 'Regime tributário', value: REGIME_LABEL[regime] ?? regime, ...from('taxRegime') }
      : { label: 'Regime tributário', value: null, state: 'missing', note: 'Responda a pergunta abaixo.' },
    fiscal?.lc116Item ? { label: 'Serviço (LC 116)', value: `item ${fiscal.lc116Item}`, ...from('lc116Item') } : { label: 'Serviço (LC 116)', value: null, state: 'missing', note: 'Vem da CNAE na consulta de CNPJ.' },
    fiscal?.issRate != null
      ? {
          label: 'Alíquota de ISS',
          value: pct(fiscal.issRate),
          ...from('issRate'),
          ...(regime === 'SIMPLES' ? { note: `${provenanceTag(prov('issRate'))?.text ?? 'Informado'}. No Simples o ISS pago sai do DAS: esta é a alíquota do município, usada na nota de serviço e na retenção.` } : {}),
        }
      : issEngine
        ? { label: 'Alíquota de ISS', value: pct(issEngine), state: 'ok', note: 'Tabela do município no Fixer (a prefeitura não informou na NFS-e Nacional). Confirme na nota de serviço.' }
        : {
          label: 'Alíquota de ISS',
          value: null,
          state: 'missing',
          note: provenance.sources?.prefeitura === false ? 'Consulta à prefeitura desligada neste ambiente: informe nos ajustes, no fim da página.' : 'A prefeitura não informou a alíquota na NFS-e Nacional: informe nos ajustes, no fim da página.',
        },
  ];
  if (tax && regime !== 'REAL') {
    if ((readiness?.regime ?? 'SIMPLES') === 'SIMPLES') {
      const rbt12 = tax.profile?.rbt12;
      taxRows.push(
        rbt12 != null
          ? { label: 'Receita dos últimos 12 meses (RBT12)', value: money(rbt12), ...from('rbt12'), note: step('dados')?.detail }
          : { label: 'Receita dos últimos 12 meses (RBT12)', value: null, state: 'missing', note: step('dados')?.detail },
      );
    } else {
      const icms = tax.profile?.icmsSalePct;
      taxRows.push(icms != null ? { label: 'ICMS cobrado na venda', value: pct(icms), ...from('icmsSalePct') } : { label: 'ICMS cobrado na venda', value: null, state: 'missing', note: step('dados')?.detail });
    }
    if (regime !== 'PRESUMIDO') {
      const reg = tax.profile?.stateTaxRegular;
      taxRows.push({
        label: 'Situação na SEFAZ estadual',
        value: reg === true ? 'Em dia' : reg === false ? 'Com pendência' : null,
        state: reg === true ? 'ok' : 'missing',
        note: reg === true ? from('stateTaxRegular').note : reg === false ? 'Paga a diferença cheia de alíquotas na antecipação do ICMS.' : 'Não informada: o custo das peças usa o pior caso (ICMS antecipado cheio).',
      });
    }
    const t = step('tabela');
    if (t) taxRows.push({ label: 'Tabelas da lei', value: t.done ? (t.basis === 'CONTADOR' ? 'Validadas pelo contador' : 'Conferidas com o texto oficial') : null, state: t.done ? 'ok' : 'missing', note: t.detail });
  }

  if (showTax) {
    taxRows.push({ label: 'ICMS-ST e PIS/COFINS monofásico', value: 'Decididos peça a peça', state: 'ok', note: 'Pelo XML da nota de compra (CST, CFOP, NCM) e pelas tabelas da lei.' });
    if (tax?.profile) taxRows.push({ label: 'Confirmação antes de lançar nota', value: tax.profile.requireTaxConfirmation ? 'Exigida' : 'Não exigida', state: 'ok' });
  }

  return (
    <div className="space-y-4">
      {readiness && showTax && !hideStatus && <TaxStatus readiness={readiness} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Group title="Empresa" rows={companyRows} />
        {showTax && (
          <Group title="Impostos" rows={taxRows}>
            {!regime && <RegimeQuestion simplesOptant={provenance.simplesOptant} />}
          </Group>
        )}
      </div>

      {showTax && hasCredential && provenance.sources?.receita && <ReceitaConsent consent={provenance.taxDataConsent ?? null} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />} Buscar de novo nas fontes oficiais
        </Button>
        {refresh.isSuccess && notices.length === 0 && (
          <span role="status" className="flex items-center gap-1 text-sm text-emerald-700">
            <Check aria-hidden className="size-4" /> Tudo atualizado
          </span>
        )}
      </div>
      {notices.length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {notices.map((n) => (
            <p key={n} className="flex items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {n}
            </p>
          ))}
        </div>
      )}
      {refresh.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {refresh.error.message}
        </p>
      )}
    </div>
  );
}

/** Uma frase sobre o imposto da venda e, quando falta só gente, o caminho até ela. */
function TaxStatus({ readiness }: { readiness: TaxReadiness }) {
  const pending = readiness.steps.filter((s) => !s.done && !s.optional);
  const onlyAccountant = pending.length > 0 && pending.every((s) => s.needsAccountant);
  const tone = readiness.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950';
  const Icon = readiness.ready ? CircleCheck : CircleAlert;
  const title = !readiness.supported ? 'Lucro Real: imposto pela regra de preço' : readiness.ready ? 'Imposto confirmado' : onlyAccountant ? 'Falta só o contador conferir' : 'Imposto ainda estimado';
  const detail = readiness.ready
    ? 'Os dados vieram de fonte oficial ou foram validados pelo contador. O preço sugerido usa o imposto confirmado.'
    : onlyAccountant
      ? pending.map((s) => s.detail).join(' ')
      : readiness.summary;

  return (
    <div role="status" className={cn('flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-start', tone)}>
      <Icon aria-hidden className="hidden size-4 shrink-0 sm:mt-0.5 sm:block" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-2 font-semibold">
          <Icon aria-hidden className="size-4 shrink-0 sm:hidden" />
          {title}
        </p>
        <p>{detail}</p>
      </div>
      {!readiness.ready && readiness.supported && (onlyAccountant || pending.some((s) => s.id === 'dados' || s.id === 'perfil')) && (
        <Button asChild size="sm" variant="outline" className="self-start bg-card">
          <Link href="/configuracoes/tributario">
            {onlyAccountant ? 'Registrar validação' : 'Completar o imposto'} <ArrowRight aria-hidden />
          </Link>
        </Button>
      )}
    </div>
  );
}

function Group({ title, rows, children }: { title: string; rows: Row[]; children?: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-xl border bg-card surface p-5 shadow-xs">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="space-y-3">
        {rows.map((r) => {
          const { icon: Icon, className, sr } = STATE_ICON[r.state];
          return (
            <div key={r.label} className="flex items-start gap-2.5 text-sm">
              <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', className)} />
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {r.label}
                  <span className="sr-only"> ({sr})</span>
                </dt>
                <dd className="font-medium break-words">{r.value ?? <span className="font-normal text-amber-800">Não encontrado</span>}</dd>
                {r.note && <dd className={cn('text-xs', r.state === 'estimated' ? 'text-amber-800' : 'text-muted-foreground')}>{r.note}</dd>}
              </div>
            </div>
          );
        })}
      </dl>
      {children}
    </section>
  );
}

/**
 * Pergunta guiada (fiscal-autofill.md §6.2): sem a Receita, só o Simples é identificado. Com a resposta, roda de novo o
 * preenchimento, que completa o que depende do regime (ICMS da venda no Presumido, RBT12 no Simples).
 */
function RegimeQuestion({ simplesOptant }: { simplesOptant: boolean | null }) {
  const router = useRouter();
  const answer = useMutation({
    mutationFn: async (taxRegime: 'SIMPLES' | 'PRESUMIDO' | 'REAL') => {
      await putJson('/api/fiscal/settings', { taxRegime }, 'Não foi possível salvar o regime.');
      await postJson('/api/fiscal/autofill', {}, 'Regime salvo, mas não foi possível completar os outros dados agora.');
    },
    onSuccess: () => router.refresh(),
  });
  const options = (simplesOptant === false ? ['PRESUMIDO', 'REAL'] : ['SIMPLES', 'PRESUMIDO', 'REAL']) as ('SIMPLES' | 'PRESUMIDO' | 'REAL')[];

  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="flex items-start gap-2 font-medium">
        <HelpCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        {simplesOptant === false ? 'A Receita informa que a empresa não é do Simples Nacional. Ela é do Lucro Presumido ou do Lucro Real?' : 'Qual é o regime tributário da empresa?'}
      </p>
      <p className="pl-6 text-sky-900">Se não souber, pergunte ao contador. Dá para mudar depois nos ajustes, no fim da página.</p>
      <div className="flex flex-wrap gap-2 pl-6">
        {options.map((r) => (
          <Button key={r} type="button" size="sm" variant="outline" className="bg-card" disabled={answer.isPending} onClick={() => answer.mutate(r)}>
            {answer.isPending && answer.variables === r && <Loader2 aria-hidden className="animate-spin" />}
            {REGIME_LABEL[r]}
          </Button>
        ))}
      </div>
      {answer.error && (
        <p role="alert" className="pl-6 font-medium text-destructive">
          {answer.error.message}
        </p>
      )}
    </div>
  );
}

/** Autorização para ler os dados de imposto na Receita com o certificado (fiscal-autofill.md §7). Só leitura. */
function ReceitaConsent({ consent }: { consent: { enabled: boolean; at: string | null } | null }) {
  const router = useRouter();
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      await putJson('/api/fiscal/autofill/consent', { enabled }, 'Não foi possível salvar a autorização.');
      if (enabled) await postJson('/api/fiscal/autofill', {}, 'Autorização salva, mas a consulta à Receita falhou agora. Tente "Buscar de novo".');
    },
    onSuccess: () => router.refresh(),
  });
  const on = consent?.enabled ?? false;

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border bg-card surface p-5 shadow-xs">
      <div className="min-w-0 space-y-1">
        <label htmlFor="receita-consent" className="text-sm font-medium">
          Buscar os dados de imposto na Receita Federal
        </label>
        <p id="receita-consent-desc" className="text-xs text-muted-foreground">
          O Fixer usa o certificado para ler o regime tributário, a RBT12 da última declaração do Simples (PGDAS-D) e os pagamentos de tributos federais. Só leitura: nada é declarado nem pago. Dá para desligar quando quiser.
          {on && consent?.at && ` Autorizado em ${new Date(consent.at).toLocaleDateString('pt-BR')}.`}
        </p>
        {toggle.error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {toggle.error.message}
          </p>
        )}
      </div>
      <Switch id="receita-consent" aria-describedby="receita-consent-desc" checked={on} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} className="mt-1" />
    </div>
  );
}
