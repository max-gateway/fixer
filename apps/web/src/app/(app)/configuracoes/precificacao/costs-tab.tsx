'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ConfidenceChip } from '@/components/confidence-chip';
import { UnitInput } from '@/components/unit-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { deleteJson, postJson, putJson } from '@/lib/client-api';
import {
  expenseBody,
  expenseSummary,
  formFromExpense,
  KIND_QUESTION,
  mixSum,
  monthlyOf,
  parseNumber,
  PAYMENT_METHODS,
  WARNING_TEXT,
  type CostExpense,
  type CostProfile,
  type CostsOverview,
  type DraftResult,
  type ExpenseForm,
} from '@/lib/costs';
import { Submit } from './pricing-settings-form';

type Enabled = Extract<CostsOverview, { enabled: true }>;
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: string | number) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const monthLabel = (p: string) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

/**
 * Aba "Despesas" (docs/specs/custos-e-impostos-ui.md, fase B, enquanto a seção Custos não entra na navegação): o perfil de
 * custos vigente, como a oficina recebe e trabalha, e o cadastro das despesas. Tudo vai para o motor de custos da plataforma.
 */
export function CostsTab({ data, canEdit }: { data: CostsOverview | null; canEdit: boolean }) {
  if (data === null) {
    return (
      <Alert variant="destructive">
        <TriangleAlert aria-hidden />
        <AlertDescription>Não foi possível carregar as despesas agora. Tente de novo em instantes.</AlertDescription>
      </Alert>
    );
  }
  if (!data.enabled) {
    return (
      <Alert variant="info">
        <TriangleAlert aria-hidden />
        <AlertDescription>O motor de custos ainda não está ligado nesta instalação do Fixer. Quando estiver, as despesas fixas da oficina passam a entrar no preço.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="max-w-3xl space-y-8">
      <ProfileCard data={data} canEdit={canEdit} />
      <SettingsForm data={data} canEdit={canEdit} />
      <ExpenseList data={data} canEdit={canEdit} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

function ProfileCard({ data, canEdit }: { data: Enabled; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const sync = useMutation({ mutationFn: () => postJson<DraftResult>('/api/costs/sync', {}, 'Não foi possível atualizar com as OS.'), onSuccess: setDraft });
  const publish = useMutation({
    mutationFn: () => postJson('/api/costs/publish', {}, 'Não foi possível publicar o perfil.'),
    onSuccess: () => {
      setDraft(null);
      router.refresh();
    },
  });
  const shown: CostProfile | null = draft?.profile ?? data.profile;

  return (
    <section aria-labelledby="costs-profile" className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 id="costs-profile" className="text-lg font-semibold">
            {draft ? 'Rascunho do perfil de custos' : 'Perfil de custos'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {shown ? (
              <>
                Base: 12 meses até {monthLabel(shown.period)}
                {!draft && data.profile?.version ? ` · versão ${data.profile.version}` : ''}
              </>
            ) : (
              'Ainda não calculado. Cadastre as despesas e atualize com as OS.'
            )}
          </p>
        </div>
        {shown && <ConfidenceChip state={shown.confidence} hint={shown.confidence === 'ESTIMADO' ? 'Veja os avisos abaixo: falta base ou informação para confirmar.' : 'Base completa, sem avisos.'} />}
      </div>

      {shown && <ProfileNumbers profile={shown} data={data} />}
      {shown && shown.warnings.length > 0 && (
        <ul className="space-y-1 text-sm">
          {shown.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-amber-900">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {WARNING_TEXT[w] ?? w}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
          <p>
            Contadas {draft.ordersCounted} OS concluídas e {draft.actualsSent} contas pagas em {draft.months} meses.
          </p>
          {draft.impact.some((i) => i.deltaPp !== null) && (
            <ul className="tabular space-y-0.5">
              {draft.impact.map((i) => (
                <li key={i.channel}>
                  {channelName(data, i.channel)}: {i.beforePp === null ? '—' : pct(i.beforePp)} → <strong>{pct(i.afterPp)}</strong> do preço
                  {i.deltaPp !== null && Number(i.deltaPp) !== 0 && ` (${Number(i.deltaPp) > 0 ? '+' : ''}${pct(i.deltaPp)})`}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Nada muda nos preços até você publicar.</p>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={draft ? 'outline' : 'default'} disabled={sync.isPending || publish.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />} Atualizar com as OS e contas pagas
          </Button>
          {draft && (
            <Button type="button" disabled={publish.isPending} onClick={() => publish.mutate()}>
              {publish.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />} Publicar este perfil
            </Button>
          )}
        </div>
      )}
      {(sync.error || publish.error) && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {(sync.error ?? publish.error)!.message}
        </p>
      )}
    </section>
  );
}

const channelName = (data: Enabled, code: string) => data.channels.find((c) => c.code === code)?.name ?? code;

function ProfileNumbers({ profile, data }: { profile: CostProfile; data: Enabled }) {
  const parts = profile.centers.PECAS;
  const services = profile.centers.SERVICOS;
  const balcao = profile.channels.BALCAO;
  return (
    <dl className="tabular grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg bg-muted/50 p-3">
        <dt className="text-xs text-muted-foreground">Estrutura nas peças</dt>
        <dd className="text-lg font-semibold">{parts?.fixedPct ? pct(parts.fixedPct) : '—'}</dd>
        <dd className="text-xs text-muted-foreground">{parts?.fixedPct ? `de cada venda pagam ${brl.format(Number(parts.fixedMonthly))}/mês` : 'sem base'}</dd>
      </div>
      <div className="rounded-lg bg-muted/50 p-3">
        <dt className="text-xs text-muted-foreground">Despesas de venda ({channelName(data, 'BALCAO').toLowerCase()})</dt>
        <dd className="text-lg font-semibold">{balcao ? pct(Number(balcao.variablePct) + Number(balcao.financialPct)) : '—'}</dd>
        <dd className="text-xs text-muted-foreground">maquininha, comissão e similares</dd>
      </div>
      <div className="rounded-lg bg-muted/50 p-3">
        <dt className="text-xs text-muted-foreground">Custo da hora da oficina</dt>
        <dd className="text-lg font-semibold">{services?.hourlyCost ? brl.format(Number(services.hourlyCost)) : '—'}</dd>
        <dd className="text-xs text-muted-foreground">{services?.productiveHours ? `${Number(services.productiveHours).toLocaleString('pt-BR')} h vendáveis/mês` : 'sem horas'}</dd>
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

function SettingsForm({ data, canEdit }: { data: Enabled; canEdit: boolean }) {
  const router = useRouter();
  const s = data.settings;
  const [mix, setMix] = useState<Record<string, string>>(Object.fromEntries(PAYMENT_METHODS.map((m) => [m.code, s.paymentMix?.[m.code] != null ? String(s.paymentMix[m.code]) : ''])));
  const [mechanics, setMechanics] = useState(s.mechanics != null ? String(s.mechanics) : '');
  const [hours, setHours] = useState(s.hoursPerMechanic != null ? String(s.hoursPerMechanic).replace('.', ',') : '176');
  const [goal, setGoal] = useState(s.partsRevenueGoal != null ? String(s.partsRevenueGoal).replace('.', ',') : '');
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({ mutationFn: (body: object) => putJson('/api/costs/settings', body, 'Não foi possível salvar.'), onSuccess: () => router.refresh() });

  const mixNums = Object.fromEntries(Object.entries(mix).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, parseNumber(v) ?? 0]));
  const anyMix = Object.keys(mixNums).length > 0;
  const total = mixSum(mixNums);
  const mixError = anyMix && Math.abs(total - 100) >= 0.5 ? `O mix soma ${total.toLocaleString('pt-BR')}%: precisa dar 100%` : null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (mixError) return;
    save.mutate({
      paymentMix: anyMix ? mixNums : null,
      mechanics: parseNumber(mechanics) === null ? null : Math.round(parseNumber(mechanics)!),
      hoursPerMechanic: parseNumber(hours),
      partsRevenueGoal: parseNumber(goal),
    });
  }

  return (
    <section aria-labelledby="costs-settings" className="space-y-3">
      <div className="space-y-0.5">
        <h2 id="costs-settings" className="text-lg font-semibold">
          Como a oficina recebe e trabalha
        </h2>
        <p className="text-sm text-muted-foreground">O Fixer não registra a forma de pagamento nem a jornada: estes números dividem a taxa da maquininha e a estrutura da oficina.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <fieldset className="space-y-2" disabled={!canEdit}>
          <legend className="text-sm font-medium">De cada R$ 100 recebidos, quanto vem por</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PAYMENT_METHODS.map((m) => (
              <Field key={m.code} id={`mix-${m.code}`} label={m.label}>
                <UnitInput id={`mix-${m.code}`} unit="%" value={mix[m.code]!} onChange={(e) => setMix((x) => ({ ...x, [m.code]: e.target.value }))} />
              </Field>
            ))}
          </div>
          {submitted && mixError && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {mixError}
            </p>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="cost-mech" label="Pessoas vendendo horas" hint="Mecânicos e eletricistas.">
            <Input id="cost-mech" inputMode="numeric" disabled={!canEdit} value={mechanics} onChange={(e) => setMechanics(e.target.value)} className="max-w-28" />
          </Field>
          <Field id="cost-hours" label="Horas de trabalho por mês" hint="Por pessoa. 8 h × 22 dias = 176.">
            <UnitInput id="cost-hours" unit="h" disabled={!canEdit} value={hours} onChange={(e) => setHours(e.target.value)} className="max-w-32" />
          </Field>
          <Field id="cost-goal" label="Meta de faturamento de peças" optional hint="Por mês. Vale enquanto não há 3 meses de OS.">
            <UnitInput id="cost-goal" unit="R$" side="start" disabled={!canEdit} value={goal} onChange={(e) => setGoal(e.target.value)} className="max-w-48" />
          </Field>
        </div>
        {canEdit && <Submit pending={save.isPending} error={save.error?.message ?? null} done={save.isSuccess} label="Salvar" />}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

function ExpenseList({ data, canEdit }: { data: Enabled; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<CostExpense | 'new' | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => deleteJson(`/api/costs/expenses/${id}`, 'Não foi possível remover.'), onSuccess: () => router.refresh() });
  const catName = (code: string) => data.categories.find((c) => c.code === code)?.name ?? code;
  const groups = [...new Set(data.expenses.map((e) => e.categoryCode))].sort((a, b) => catName(a).localeCompare(catName(b)));
  const fixedTotal = data.expenses.reduce((s, e) => s + monthlyOf(e), 0);

  return (
    <section aria-labelledby="costs-expenses" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h2 id="costs-expenses" className="text-lg font-semibold">
            Despesas
          </h2>
          <p className="tabular text-sm text-muted-foreground">Fixas: {brl.format(fixedTotal)} por mês</p>
        </div>
        {canEdit && (
          <Button type="button" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Nova despesa
          </Button>
        )}
      </div>

      {data.expenses.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">Nenhuma despesa cadastrada. Comece pelo aluguel, a folha, o contador e a taxa da maquininha.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g} className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{catName(g)}</h3>
              <ul className="divide-y rounded-xl border bg-card">
                {data.expenses
                  .filter((e) => e.categoryCode === g)
                  .map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{e.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {expenseSummary(e)}
                          {e.allocations[0] && ` · ${data.costCenters.find((c) => c.code === e.allocations[0]!.costCenter)?.name ?? e.allocations[0].costCenter}`}
                        </span>
                      </span>
                      {canEdit && (
                        <span className="flex gap-1">
                          <Button type="button" size="icon" variant="ghost" aria-label={`Editar ${e.name}`} onClick={() => setEditing(e)}>
                            <Pencil aria-hidden />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" aria-label={`Remover ${e.name}`} disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>
                            <Trash2 aria-hidden />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {remove.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {remove.error.message}
        </p>
      )}
      {editing && <ExpenseSheet data={data} expense={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function ExpenseSheet({ data, expense, onClose }: { data: Enabled; expense: CostExpense | null; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<ExpenseForm>(
    expense
      ? formFromExpense(expense)
      : { kind: 'FIXED', categoryCode: 'OCUPACAO.ALUGUEL', name: '', value: '', recurrence: 'MONTHLY', amortizeMonths: '12', costCenter: 'PECAS', effectiveFrom: `${today().slice(0, 8)}01`, channels: [], paymentMethods: [] },
  );
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof ExpenseForm>(k: K, v: ExpenseForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: (body: object) => (expense ? putJson(`/api/costs/expenses/${expense.id}`, body, 'Não foi possível salvar a despesa.') : postJson('/api/costs/expenses', body, 'Não foi possível salvar a despesa.')),
    onSuccess: () => {
      router.refresh();
      onClose();
    },
  });
  const isPct = f.kind === 'SALE_PCT';
  const errors = { name: f.name.trim() ? null : 'Dê um nome à despesa', value: parseNumber(f.value) === null ? (isPct ? 'Informe o percentual' : 'Informe o valor') : null };
  // Categorias que combinam com o tipo escolhido primeiro; as demais continuam disponíveis.
  const cats = [...data.categories].sort((a, b) => Number(b.defaultKind === f.kind) - Number(a.defaultKind === f.kind) || a.name.localeCompare(b.name));
  const toggle = (k: 'channels' | 'paymentMethods', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (errors.name || errors.value) return;
    save.mutate(expenseBody(f));
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby="expense-sheet-desc">
        <header className="space-y-1 border-b px-5 py-4 pr-12">
          <SheetTitle>{expense ? 'Editar despesa' : 'Nova despesa'}</SheetTitle>
          <SheetDescription id="expense-sheet-desc">Ela entra no rateio do próximo perfil de custos que você publicar.</SheetDescription>
        </header>
        <form onSubmit={onSubmit} className="space-y-4 overflow-y-auto px-5 py-4" noValidate>
          <Field id="exp-name" label="Nome" error={submitted ? errors.name : null}>
            <Input id="exp-name" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={160} />
          </Field>
          <fieldset className="space-y-1.5">
            <legend id="exp-kind" className="text-sm font-medium">
              Como ela muda?
            </legend>
            <RadioGroup value={f.kind} onValueChange={(v) => set('kind', v as ExpenseForm['kind'])} aria-labelledby="exp-kind" className="gap-1.5">
              {KIND_QUESTION.map((k) => (
                <label key={k.kind} className="flex cursor-pointer items-start gap-2 text-sm">
                  <RadioGroupItem value={k.kind} className="mt-0.5" />
                  <span>
                    {k.label}
                    <span className="block text-xs text-muted-foreground">{k.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <Field id="exp-cat" label="Categoria">
            <Select id="exp-cat" value={f.categoryCode} onChange={(e) => set('categoryCode', e.target.value)}>
              {cats.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="exp-value" label={isPct ? 'Percentual' : 'Valor'} error={submitted ? errors.value : null} hint={isPct ? 'Comum: maquininha de 2% a 5%.' : undefined}>
              <UnitInput id="exp-value" unit={isPct ? '%' : 'R$'} side={isPct ? 'end' : 'start'} value={f.value} onChange={(e) => set('value', e.target.value)} error={submitted ? errors.value : null} />
            </Field>
            {f.kind === 'FIXED' && (
              <Field id="exp-rec" label="A cada">
                <Select id="exp-rec" value={f.recurrence} onChange={(e) => set('recurrence', e.target.value as ExpenseForm['recurrence'])}>
                  <option value="MONTHLY">mês</option>
                  <option value="ANNUAL">ano (dividido por 12)</option>
                  <option value="ONE_OFF_AMORTIZED">parcelado em meses</option>
                </Select>
              </Field>
            )}
          </div>
          {f.kind === 'FIXED' && f.recurrence === 'ONE_OFF_AMORTIZED' && (
            <Field id="exp-months" label="Em quantos meses">
              <Input id="exp-months" inputMode="numeric" value={f.amortizeMonths} onChange={(e) => set('amortizeMonths', e.target.value)} className="max-w-24" />
            </Field>
          )}
          {f.kind === 'FIXED' ? (
            <Field id="exp-center" label="De quem é" hint="Peças carregam a estrutura no preço; a oficina, no custo da hora; a administração é dividida pelo faturamento.">
              <Select id="exp-center" value={f.costCenter} onChange={(e) => set('costCenter', e.target.value)}>
                {data.costCenters.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Vale em</legend>
                <p className="text-xs text-muted-foreground">Nenhum marcado = em todas as vendas.</p>
                {data.channels.map((c) => (
                  <label key={c.code} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={f.channels.includes(c.code)} onCheckedChange={() => toggle('channels', c.code)} />
                    {c.name}
                  </label>
                ))}
              </fieldset>
              {isPct && (
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">Só quando pagam com</legend>
                  <p className="text-xs text-muted-foreground">Para a taxa da maquininha. Nenhum marcado = toda venda.</p>
                  {PAYMENT_METHODS.map((m) => (
                    <label key={m.code} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={f.paymentMethods.includes(m.code)} onCheckedChange={() => toggle('paymentMethods', m.code)} />
                      {m.label}
                    </label>
                  ))}
                </fieldset>
              )}
            </>
          )}
          <Field id="exp-from" label="Desde">
            <Input id="exp-from" type="date" value={f.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} className="max-w-48" />
          </Field>
          <Submit pending={save.isPending} error={save.error?.message ?? null} done={false} label={expense ? 'Salvar' : 'Adicionar'} />
        </form>
      </SheetContent>
    </Sheet>
  );
}
