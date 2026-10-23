'use client';

import { Check, Clock, KeyRound, Loader2, Mail, Power, PowerOff, ShieldAlert, UserMinus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { UserAvatar } from '@/components/nav/user-avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { useAccessActions, useAudit } from '../hooks';
import { auditSentence, diff, effective, relative, roleStyle, sameSet } from '../model';
import type { Catalog, Member, Role } from '../types';
import { errorText, ManagerMark, SectionTitle, StatusPill } from './bits';

type Props = { member: Member | null; roles: Role[]; catalog: Catalog; canManage: boolean; onClose: () => void };

/** Gaveta da pessoa: papéis (com prévia do que ela passa a poder fazer), ações da conta e histórico dela. */
export function MemberSheet({ member, roles, catalog, canManage, onClose }: Props) {
  return (
    <Sheet open={!!member} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-[34rem]">{member && <Body key={member.sub + member.roleIds.join()} member={member} roles={roles} catalog={catalog} canManage={canManage} onClose={onClose} />}</SheetContent>
    </Sheet>
  );
}

function Body({ member, roles, catalog, canManage, onClose }: Props & { member: Member }) {
  const { toast } = useToast();
  const actions = useAccessActions();
  const [draft, setDraft] = useState<string[]>(member.roleIds);
  const [confirm, setConfirm] = useState<'remove' | 'deactivate' | null>(null);
  const dirty = !sameSet(draft, member.roleIds);
  const change = diff(member.roleIds, draft);
  const before = useMemo(() => effective(member.roleIds, roles), [member.roleIds, roles]);
  const after = useMemo(() => effective(draft, roles), [draft, roles]);
  const editable = canManage && member.status !== 'blocked';
  const inactive = member.status === 'inactive';

  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const run = async (fn: () => Promise<unknown>, ok: string, description?: string) => {
    try {
      await fn();
      toast({ title: ok, description });
      return true;
    } catch (err) {
      toast({ title: errorText(err), tone: 'error' });
      return false;
    }
  };

  const save = () =>
    run(
      () => actions.setRoles.mutateAsync({ sub: member.sub, roleIds: draft }),
      member.status === 'unlinked' ? `${member.name} agora tem acesso` : 'Papéis atualizados',
      [change.added.length && `+${change.added.length} papel(is)`, change.removed.length && `−${change.removed.length} papel(is)`].filter(Boolean).join(' · ') || undefined,
    );

  const lastSeen = member.lastSeenAt ? `Último acesso ${relative(member.lastSeenAt)}` : member.status === 'unlinked' ? 'Ainda sem acesso ao Fixer' : 'Nunca entrou';

  return (
    <>
      <div className="relative shrink-0 overflow-hidden border-b px-5 pt-6 pb-5">
        <div aria-hidden className="absolute inset-x-0 top-0 h-20 bg-[linear-gradient(120deg,var(--brand-secondary),color-mix(in_oklab,var(--brand-secondary)_65%,var(--brand-primary)))]" />
        <div className="relative flex items-end gap-4 pt-6">
          <UserAvatar name={member.name} className="size-16 text-xl ring-4 ring-background" />
          <div className="min-w-0 pb-1">
            <SheetTitle className="flex items-center gap-1.5 truncate">
              {member.name} {member.isManager && <ManagerMark />}
            </SheetTitle>
            <SheetDescription className="truncate">{member.email}</SheetDescription>
          </div>
        </div>
        <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusPill status={member.status} />
          <span className="inline-flex items-center gap-1">
            <Clock aria-hidden className="size-3.5" /> {lastSeen}
          </span>
          {member.isSelf && <span className="rounded bg-muted px-1.5 py-px font-semibold">você</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {member.isSelf && canManage && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-950 ring-1 ring-amber-600/15">
            <ShieldAlert aria-hidden className="mt-px size-4 shrink-0" />
            Este é você. O sistema não deixa você tirar o seu próprio acesso a esta tela; peça a outro administrador.
          </p>
        )}

        <section className="space-y-2.5">
          <SectionTitle aside={<span className="text-xs text-muted-foreground tabular">{draft.length} selecionado(s)</span>}>Papéis</SectionTitle>
          <ul className="space-y-1.5">
            {roles.map((r) => {
              const on = draft.includes(r.id);
              const id = `role-${member.sub}-${r.id}`;
              return (
                <li key={r.id}>
                  <label
                    htmlFor={id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all',
                      on ? 'border-brand/50 bg-brand-soft/60 shadow-xs' : 'hover:border-foreground/20 hover:bg-muted/40',
                      !editable && 'cursor-default opacity-80',
                    )}
                  >
                    <Checkbox id={id} checked={on} onCheckedChange={() => toggle(r.id)} disabled={!editable} className="mt-0.5" />
                    <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-full border" style={{ backgroundColor: roleStyle(r).color, borderColor: roleStyle(r).borderColor }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{r.name}</span>
                        <span className="text-xs text-muted-foreground tabular">{r.permissions.length} perm.</span>
                      </span>
                      {r.description && <span className="mt-0.5 block text-xs text-muted-foreground">{r.description}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-2.5">
          <SectionTitle aside={dirty ? <span className="text-xs font-medium text-brand">prévia com as mudanças</span> : null}>O que pode fazer</SectionTitle>
          <PermissionPreview catalog={catalog} before={before} after={after} />
        </section>

        {editable && member.userId && (
          <section className="space-y-2">
            <SectionTitle>Conta</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                className="justify-start"
                disabled={actions.setupEmail.isPending || inactive}
                onClick={() =>
                  run(
                    () => actions.setupEmail.mutateAsync(member.sub),
                    member.lastSeenAt ? 'E-mail de redefinição de senha enviado' : 'Convite reenviado',
                    member.email,
                  )
                }
              >
                {actions.setupEmail.isPending ? <Loader2 className="animate-spin" /> : member.lastSeenAt ? <KeyRound /> : <Mail />}
                {member.lastSeenAt ? 'Redefinir senha' : 'Reenviar convite'}
              </Button>
              {inactive ? (
                <Button variant="outline" className="justify-start" disabled={actions.reactivate.isPending} onClick={() => run(() => actions.reactivate.mutateAsync(member.sub), `${member.name} foi reativado`)}>
                  <Power /> Reativar
                </Button>
              ) : (
                <Button variant="outline" className="justify-start" disabled={member.isSelf} onClick={() => setConfirm('deactivate')}>
                  <PowerOff /> Desativar
                </Button>
              )}
            </div>
            {!member.isSelf && (
              <button type="button" onClick={() => setConfirm('remove')} className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-destructive hover:underline">
                <UserMinus aria-hidden className="size-4" /> Remover da oficina
              </button>
            )}
          </section>
        )}

        <PersonHistory sub={member.sub} catalog={catalog} />
      </div>

      {editable && (
        <div className={cn('shrink-0 border-t bg-card/95 px-5 py-3 backdrop-blur transition-all', dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none h-0 translate-y-2 overflow-hidden border-0 py-0 opacity-0')}>
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">Alterações não salvas</span>
              <span className="text-muted-foreground">
                {change.added.length > 0 && ` · +${change.added.length}`}
                {change.removed.length > 0 && ` · −${change.removed.length}`}
              </span>
            </p>
            <Button variant="ghost" size="sm" onClick={() => setDraft(member.roleIds)}>
              Descartar
            </Button>
            <Button size="sm" onClick={save} disabled={actions.setRoles.isPending}>
              {actions.setRoles.isPending ? <Loader2 className="animate-spin" /> : <Check />} Salvar
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'remove' ? `Remover ${member.name} da oficina?` : `Desativar ${member.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'remove'
                ? 'A pessoa perde todos os papéis e sai da organização no login. Para voltar, será preciso convidar de novo.'
                : 'A pessoa não consegue mais entrar nesta oficina, mas mantém os papéis. Você pode reativar quando quiser.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                const ok =
                  confirm === 'remove'
                    ? await run(() => actions.remove.mutateAsync(member.sub), `${member.name} foi removido da oficina`)
                    : await run(() => actions.deactivate.mutateAsync(member.sub), `${member.name} foi desativado`);
                if (ok && confirm === 'remove') onClose();
              }}
            >
              {confirm === 'remove' ? 'Remover' : 'Desativar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Permissões efetivas por área, marcando o que entra (verde) e o que sai (riscado) com os papéis em edição. */
function PermissionPreview({ catalog, before, after }: { catalog: Catalog; before: Set<string>; after: Set<string> }) {
  const groups = catalog.groups
    .map((g) => ({ g, items: g.permissions.filter((p) => before.has(p.key) || after.has(p.key)) }))
    .filter((x) => x.items.length > 0);
  if (groups.length === 0) return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Sem permissões especiais. A pessoa vê o básico da oficina (ordens, clientes).</p>;
  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
      {groups.map(({ g, items }) => (
        <div key={g.key}>
          <p className="text-xs font-semibold">{g.label}</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {items.map((p) => {
              const added = after.has(p.key) && !before.has(p.key);
              const removed = before.has(p.key) && !after.has(p.key);
              return (
                <li
                  key={p.key}
                  title={p.key}
                  className={cn(
                    'rounded-md bg-card px-1.5 py-0.5 text-xs ring-1 ring-border',
                    added && 'bg-emerald-50 text-emerald-900 ring-emerald-600/30',
                    removed && 'bg-red-50 text-red-800 line-through ring-red-600/20',
                  )}
                >
                  {added && <span className="sr-only">ganha: </span>}
                  {removed && <span className="sr-only">perde: </span>}
                  {p.label}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PersonHistory({ sub, catalog }: { sub: string; catalog: Catalog }) {
  const audit = useAudit(sub);
  const items = audit.data?.pages.flatMap((p) => p.items).slice(0, 6) ?? [];
  if (audit.isLoading || items.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionTitle>Histórico</SectionTitle>
      <ol className="space-y-2 border-l pl-4">
        {items.map((it) => {
          const s = auditSentence(it, catalog);
          return (
            <li key={it.id} className="relative text-sm">
              <span aria-hidden className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-border ring-2 ring-background" />
              <p>{s.title}</p>
              <p className="text-xs text-muted-foreground">
                <time dateTime={it.at} title={new Date(it.at).toLocaleString('pt-BR')}>
                  {relative(it.at)}
                </time>
                {s.detail && ` · ${s.detail}`}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
