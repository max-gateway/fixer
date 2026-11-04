'use client';

import { BadgeCheck, Briefcase, CalendarDays, Cake, KeyRound, Loader2, Mail, MapPin, Pencil, Phone, Plus, Power, UserMinus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { UserAvatar } from '@/components/nav/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  activeEngagements,
  currentPositions,
  displayName,
  formatDate,
  formatMonthYear,
  headline,
  KIND_LABEL,
  KINDS,
  tenure,
  todayIso,
  type Access,
  type Engagement,
  type EngagementKind,
  type PersonDetail,
  type Position,
  type Unit,
} from '@/lib/workforce';
import { useWorkforceActions, usePerson } from './hooks';
import { PersonFormSheet } from './person-form-sheet';

type Notify = (title: string, description?: string) => void;

export function PersonSheet({
  id,
  access,
  units,
  positions,
  onClose,
  onNotify,
}: {
  id: string | null;
  access: Access;
  units: Unit[];
  positions: Position[];
  onClose: () => void;
  onNotify: Notify;
}) {
  const person = usePerson(id);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined} className="sm:max-w-[34rem]">
        {person.data ? (
          <Body key={person.data.id} p={person.data} access={access} units={units} positions={positions} onNotify={onNotify} />
        ) : (
          <div className="space-y-4 p-6" aria-busy={person.isPending}>
            <SheetTitle className="sr-only">Ficha da pessoa</SheetTitle>
            {person.isPending ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="skeleton size-14 rounded-full" />
                  <div className="space-y-2">
                    <div className="skeleton h-5 w-48 rounded" />
                    <div className="skeleton h-3 w-32 rounded" />
                  </div>
                </div>
                <div className="skeleton h-24 w-full rounded-xl" />
                <div className="skeleton h-40 w-full rounded-xl" />
              </>
            ) : (
              <p role="alert" className="text-sm text-destructive">
                {(person.error as Error)?.message ?? 'Não foi possível carregar a pessoa.'}
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body({ p, access, units, positions, onNotify }: { p: PersonDetail; access: Access; units: Unit[]; positions: Position[]; onNotify: Notify }) {
  const { update } = useWorkforceActions();
  const [editing, setEditing] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();
  const head = headline(p, today);
  const canAdmit = access.manage && p.status === 'active' && !p.anonymized;
  const inactive = p.status === 'inactive';

  const setStatus = async (status: 'active' | 'inactive') => {
    setError(null);
    try {
      await update.mutateAsync({ id: p.id, version: p.version, status });
      setConfirmOff(false);
      onNotify(status === 'active' ? 'Pessoa reativada' : 'Pessoa inativada');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <header className="relative overflow-hidden border-b px-6 pt-6 pb-5 pr-12">
        <div aria-hidden className="bg-brand-glow absolute inset-0 -z-10 opacity-70" />
        <div className="flex items-center gap-4">
          <UserAvatar name={displayName(p)} className={cn('size-16 text-xl', inactive && 'grayscale')} />
          <div className="min-w-0">
            <SheetTitle className="truncate text-xl">{displayName(p)}</SheetTitle>
            <SheetDescription className="truncate">{p.socialName ? p.name : (head?.position ?? 'Sem função em vigor')}</SheetDescription>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={inactive ? 'secondary' : 'success'}>{inactive ? 'Inativo' : 'Ativo'}</Badge>
              {p.hasLogin && (
                <Badge variant="outline" className="border-brand/25 bg-brand-soft text-brand">
                  <KeyRound aria-hidden />
                  Acessa o sistema
                </Badge>
              )}
              {head && <Badge variant="outline">{KIND_LABEL[head.engagement.kind]}</Badge>}
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {p.anonymized && (
          <p className="rounded-lg border border-amber-600/20 bg-amber-100 px-3 py-2 text-sm text-amber-900">Pessoa anonimizada (LGPD): os dados pessoais foram removidos e não podem ser alterados.</p>
        )}

        <section aria-labelledby="wf-dados" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 id="wf-dados" className="text-sm font-semibold text-muted-foreground">
              Dados
            </h3>
            {access.manage && !p.anonymized && (
              <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Editar
              </Button>
            )}
          </div>
          <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
            <Info icon={<BadgeCheck aria-hidden />} label="CPF" value={<span className="tabular font-mono">{p.cpf}</span>} />
            <Info icon={<Cake aria-hidden />} label="Nascimento" value={p.birthDate ? formatDate(p.birthDate) : null} />
            <Info icon={<Mail aria-hidden />} label="E-mail" value={p.email} />
            <Info icon={<Phone aria-hidden />} label="Telefone" value={p.phone} />
          </dl>
        </section>

        <section aria-labelledby="wf-vinculos" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 id="wf-vinculos" className="text-sm font-semibold text-muted-foreground">
              Vínculos <span className="tabular font-normal">({p.engagements.length})</span>
            </h3>
            {canAdmit && !admitting && (
              <Button size="xs" variant="ghost" onClick={() => setAdmitting(true)}>
                <Plus aria-hidden />
                Novo vínculo
              </Button>
            )}
          </div>

          {admitting && (
            <AdmitForm
              personId={p.id}
              units={units}
              positions={positions}
              onCancel={() => setAdmitting(false)}
              onDone={() => {
                setAdmitting(false);
                onNotify('Vínculo registrado');
              }}
            />
          )}

          {p.engagements.length === 0 && !admitting ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center">
              <Briefcase aria-hidden className="mx-auto mb-2 size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Ainda sem vínculo</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Admita a pessoa para ela ter função, unidade e entrar nas comissões.</p>
              {canAdmit && (
                <Button className="mt-3" size="sm" onClick={() => setAdmitting(true)}>
                  <Plus aria-hidden />
                  Admitir
                </Button>
              )}
            </div>
          ) : (
            <ol className="space-y-3">
              {[...p.engagements].reverse().map((e) => (
                <li key={e.id}>
                  <EngagementCard e={e} person={p} today={today} manage={access.manage && !p.anonymized} positions={positions} onNotify={onNotify} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className="text-xs text-muted-foreground">Cadastrada em {formatDate(p.createdAt)}</p>
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </p>
        )}
      </div>

      {access.manage && !p.anonymized && (
        <footer className="flex items-center justify-between gap-2 border-t bg-card/60 px-6 py-3">
          {inactive ? (
            <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => setStatus('active')}>
              {update.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Power aria-hidden />}
              Reativar
            </Button>
          ) : confirmOff ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Inativar {displayName(p).split(' ')[0]}?</span>
              <Button size="sm" variant="destructive" disabled={update.isPending} onClick={() => setStatus('inactive')}>
                {update.isPending && <Loader2 aria-hidden className="animate-spin" />}
                Inativar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOff(false)}>
                Voltar
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmOff(true)}>
              <Power aria-hidden />
              Inativar
            </Button>
          )}
        </footer>
      )}

      <PersonFormSheet
        mode="edit"
        open={editing}
        person={p}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onNotify('Dados atualizados');
        }}
      />
    </>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 bg-card px-3.5 py-3">
      <span className="mt-0.5 text-muted-foreground [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-medium">{value || <span className="font-normal text-muted-foreground">Não informado</span>}</dd>
      </div>
    </div>
  );
}

type Mode = null | 'assign' | 'terminate';

function EngagementCard({ e, person, today, manage, positions, onNotify }: { e: Engagement; person: PersonDetail; today: string; manage: boolean; positions: Position[]; onNotify: Notify }) {
  const [mode, setMode] = useState<Mode>(null);
  const active = e.status === 'active';
  const now = currentPositions(e, today);
  const lastActive = active && activeEngagements(person).length === 1;

  return (
    <article className={cn('overflow-hidden rounded-xl border bg-card', !active && 'bg-muted/40')}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={active ? 'success' : 'secondary'}>{active ? 'Em vigor' : 'Encerrado'}</Badge>
            <Badge variant="outline">{KIND_LABEL[e.kind]}</Badge>
            {e.unitName && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin aria-hidden className="size-3" />
                {e.unitName}
              </span>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays aria-hidden className="size-3.5" />
            <span className="tabular">
              {formatDate(e.admittedOn)} → {e.terminatedOn ? formatDate(e.terminatedOn) : 'hoje'}
            </span>
            <span aria-hidden>·</span>
            {tenure(e.admittedOn, e.terminatedOn ?? today)}
          </p>
        </div>
      </div>

      <div className="px-4 py-3">
        {e.positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem função atribuída.</p>
        ) : (
          <ol className="relative space-y-2.5 border-l pl-4">
            {e.positions.map((a) => {
              const open = now.includes(a);
              return (
                <li key={`${a.positionKey}-${a.validFrom}`} className="relative">
                  <span aria-hidden className={cn('absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full border-2 border-card', open ? 'bg-brand' : 'bg-input')} />
                  <p className={cn('text-sm font-medium', !open && 'text-muted-foreground')}>{a.positionName}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {formatMonthYear(a.validFrom)} → {a.validTo ? formatMonthYear(a.validTo) : 'atual'}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {manage && active && mode === null && (
        <div className="flex gap-2 border-t bg-muted/30 px-4 py-2">
          <Button size="xs" variant="ghost" onClick={() => setMode('assign')}>
            <Briefcase aria-hidden />
            Mudar função
          </Button>
          <Button size="xs" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setMode('terminate')}>
            <UserMinus aria-hidden />
            Encerrar vínculo
          </Button>
        </div>
      )}
      {mode === 'assign' && <AssignForm e={e} positions={positions} today={today} onCancel={() => setMode(null)} onDone={() => (setMode(null), onNotify('Função atribuída'))} />}
      {mode === 'terminate' && (
        <TerminateForm
          e={e}
          today={today}
          warnLogin={lastActive && person.hasLogin}
          onCancel={() => setMode(null)}
          onDone={(revoked) => (setMode(null), onNotify('Vínculo encerrado', revoked ? 'Era o último vínculo: o acesso ao sistema será revogado.' : undefined))}
        />
      )}
    </article>
  );
}

const panel = 'space-y-3 border-t bg-muted/30 px-4 py-3';

function FormActions({ busy, submit, onCancel, danger }: { busy: boolean; submit: string; onCancel: () => void; danger?: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
        Cancelar
      </Button>
      <Button type="submit" size="sm" variant={danger ? 'destructive' : 'default'} disabled={busy}>
        {busy && <Loader2 aria-hidden className="animate-spin" />}
        {submit}
      </Button>
    </div>
  );
}

const ErrorLine = ({ msg }: { msg: string | null }) =>
  msg ? (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
      {msg}
    </p>
  ) : null;

function AssignForm({ e, positions, today, onCancel, onDone }: { e: Engagement; positions: Position[]; today: string; onCancel: () => void; onDone: () => void }) {
  const { assign } = useWorkforceActions();
  const options = positions.filter((p) => p.status === 'active');
  const [key, setKey] = useState('');
  const [from, setFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!key || !from) return;
    setError(null);
    try {
      await assign.mutateAsync({ engagementId: e.id, positionKey: key, validFrom: from });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className={panel}>
      <Field id={`as-pos-${e.id}`} label="Nova função" hint={options.length === 0 ? 'Nenhuma função cadastrada ainda no workforce.' : undefined}>
        <Select id={`as-pos-${e.id}`} value={key} onChange={(ev) => setKey(ev.target.value)} aria-describedby={`as-pos-${e.id}-msg`}>
          <option value="">Escolha…</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`as-from-${e.id}`} label="A partir de">
        <Input id={`as-from-${e.id}`} type="date" min={e.admittedOn} value={from} onChange={(ev) => setFrom(ev.target.value)} className="sm:w-48" />
      </Field>
      <ErrorLine msg={error} />
      <FormActions busy={assign.isPending} submit="Atribuir" onCancel={onCancel} />
    </form>
  );
}

function TerminateForm({ e, today, warnLogin, onCancel, onDone }: { e: Engagement; today: string; warnLogin: boolean; onCancel: () => void; onDone: (revoked: boolean) => void }) {
  const { terminate } = useWorkforceActions();
  const [on, setOn] = useState(today);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (reason.trim().length < 3 || !on) return;
    setError(null);
    try {
      const out = await terminate.mutateAsync({ engagementId: e.id, terminatedOn: on, reason: reason.trim() });
      onDone(out.lastActive);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className={panel}>
      {warnLogin && <p className="rounded-lg border border-amber-600/20 bg-amber-100 px-3 py-2 text-sm text-amber-900">É o último vínculo ativo: ao encerrar, o acesso desta pessoa ao sistema é revogado.</p>}
      <Field id={`tm-on-${e.id}`} label="Data do desligamento">
        <Input id={`tm-on-${e.id}`} type="date" min={e.admittedOn} value={on} onChange={(ev) => setOn(ev.target.value)} className="sm:w-48" />
      </Field>
      <Field id={`tm-why-${e.id}`} label="Motivo" hint="Fica registrado na auditoria.">
        <Input id={`tm-why-${e.id}`} autoFocus maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} aria-describedby={`tm-why-${e.id}-msg`} />
      </Field>
      <ErrorLine msg={error} />
      <FormActions busy={terminate.isPending} submit="Encerrar vínculo" danger onCancel={onCancel} />
    </form>
  );
}

function AdmitForm({ personId, units, positions, onCancel, onDone }: { personId: string; units: Unit[]; positions: Position[]; onCancel: () => void; onDone: () => void }) {
  const { admit } = useWorkforceActions();
  const [kind, setKind] = useState<EngagementKind>('clt');
  const [unitId, setUnitId] = useState('');
  const [admittedOn, setAdmittedOn] = useState(todayIso());
  const [positionKey, setPositionKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const activeUnits = units.filter((u) => u.status === 'active');

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!admittedOn) return;
    setError(null);
    try {
      await admit.mutateAsync({ personId, kind, admittedOn, unitId: unitId || null, ...(positionKey ? { positionKey } : {}) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-brand/30 bg-brand-soft/50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ad-kind" label="Tipo de vínculo">
          <Select id="ad-kind" value={kind} onChange={(e) => setKind(e.target.value as EngagementKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ad-on" label="Admissão">
          <Input id="ad-on" type="date" value={admittedOn} onChange={(e) => setAdmittedOn(e.target.value)} />
        </Field>
        <Field id="ad-unit" label="Unidade" optional>
          <Select id="ad-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Sem unidade</option>
            {activeUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ad-pos" label="Função" optional>
          <Select id="ad-pos" value={positionKey} onChange={(e) => setPositionKey(e.target.value)}>
            <option value="">Definir depois</option>
            {positions
              .filter((p) => p.status === 'active')
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <ErrorLine msg={error} />
      <FormActions busy={admit.isPending} submit="Registrar vínculo" onCancel={onCancel} />
    </form>
  );
}
