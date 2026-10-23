'use client';

import { Check, Copy, Crown, Loader2, Lock, Plus, ShieldAlert, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { useAccessActions } from '../hooks';
import { allPermissionKeys, coverage, diff, roleStyle, sameSet } from '../model';
import type { Catalog, Role } from '../types';
import { errorText } from './bits';

type Draft = { name: string; description: string; permissions: string[] };
type Selection = { kind: 'role'; id: string } | { kind: 'new'; seed: Draft };

const blank: Draft = { name: '', description: '', permissions: [] };

/** Papéis à esquerda; editor de permissões à direita (no celular, um embaixo do outro). */
export function RolesPanel({ roles, catalog, canManage }: { roles: Role[]; catalog: Catalog; canManage: boolean }) {
  const [sel, setSel] = useState<Selection>(() => ({ kind: 'role', id: roles.find((r) => !r.isSystem)?.id ?? roles[0]?.id ?? '' }));
  const total = allPermissionKeys(catalog).length;
  const role = sel.kind === 'role' ? roles.find((r) => r.id === sel.id) : undefined;

  // O papel aberto foi excluído (aqui ou em outra aba): volta para o primeiro.
  useEffect(() => {
    if (sel.kind === 'role' && !role && roles[0]) setSel({ kind: 'role', id: roles[0].id });
  }, [sel, role, roles]);

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <aside className="space-y-2">
        <ul className="space-y-1.5" aria-label="Papéis">
          {roles.map((r) => {
            const active = sel.kind === 'role' && sel.id === r.id;
            const pct = total ? r.permissions.length / total : 0;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSel({ kind: 'role', id: r.id })}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'group w-full rounded-xl border bg-card px-3.5 py-3 text-left shadow-xs transition-all focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                    active ? 'border-brand ring-1 ring-brand/40' : 'hover:border-foreground/20',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="grid size-7 place-items-center rounded-lg border text-xs font-bold" style={roleStyle(r)}>
                      {r.isSystem ? <Crown className="size-3.5" /> : r.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular" title="Pessoas ativas com este papel">
                      <Users aria-hidden className="size-3.5" /> {r.memberCount}
                    </span>
                  </span>
                  <span className="mt-2 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, backgroundColor: roleStyle(r).color }} />
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular">
                      {r.permissions.length}/{total}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {canManage && (
          <Button variant="outline" className={cn('w-full border-dashed', sel.kind === 'new' && 'border-brand text-brand')} onClick={() => setSel({ kind: 'new', seed: blank })}>
            <Plus /> Novo papel
          </Button>
        )}
      </aside>

      {sel.kind === 'new' ? (
        <RoleEditor key={`new-${sel.seed.name}`} role={null} seed={sel.seed} catalog={catalog} canManage={canManage} onSaved={(id) => setSel({ kind: 'role', id })} onDuplicate={() => undefined} onCancel={() => setSel({ kind: 'role', id: roles[0]?.id ?? '' })} />
      ) : role ? (
        <RoleEditor
          key={role.id + role.permissions.join() + role.name + role.description}
          role={role}
          seed={{ name: role.name, description: role.description ?? '', permissions: role.permissions }}
          catalog={catalog}
          canManage={canManage}
          onSaved={() => undefined}
          onDuplicate={(d) => setSel({ kind: 'new', seed: d })}
          onCancel={() => undefined}
        />
      ) : null}
    </div>
  );
}

function RoleEditor({
  role,
  seed,
  catalog,
  canManage,
  onSaved,
  onDuplicate,
  onCancel,
}: {
  role: Role | null;
  seed: Draft;
  catalog: Catalog;
  canManage: boolean;
  onSaved: (id: string) => void;
  onDuplicate: (d: Draft) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const actions = useAccessActions();
  const [draft, setDraft] = useState<Draft>(seed);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = !canManage || !!role?.isSystem;
  const granted = useMemo(() => new Set(draft.permissions), [draft.permissions]);
  const change = diff(seed.permissions, draft.permissions);
  const dirty = !role || draft.name !== seed.name || draft.description !== seed.description || !sameSet(draft.permissions, seed.permissions);
  const pending = actions.createRole.isPending || actions.updateRole.isPending;

  const set = (keys: string[], on: boolean) =>
    setDraft((d) => ({ ...d, permissions: on ? [...new Set([...d.permissions, ...keys])] : d.permissions.filter((k) => !keys.includes(k)) }));

  const save = async () => {
    try {
      if (!role) {
        const res = await actions.createRole.mutateAsync({ name: draft.name, description: draft.description || null, permissions: draft.permissions });
        toast({ title: `Papel "${draft.name.trim()}" criado` });
        onSaved(res.id);
      } else {
        await actions.updateRole.mutateAsync({
          id: role.id,
          ...(draft.name !== seed.name ? { name: draft.name } : {}),
          ...(draft.description !== seed.description ? { description: draft.description || null } : {}),
          ...(!sameSet(draft.permissions, seed.permissions) ? { permissions: draft.permissions } : {}),
        });
        toast({ title: 'Papel salvo', description: role.memberCount ? `Vale na hora para ${role.memberCount} pessoa(s).` : undefined });
      }
    } catch (err) {
      toast({ title: errorText(err), tone: 'error' });
    }
  };

  return (
    <div className="relative min-w-0 rounded-xl border bg-card shadow-xs">
      <div className="space-y-3 border-b p-4 sm:p-5">
        {role?.isSystem && (
          <p className="flex items-start gap-2 rounded-lg bg-brand-soft p-3 text-sm ring-1 ring-brand/20">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>
              <span className="font-medium">Papel de sistema.</span> O Admin tem sempre todas as permissões, inclusive as que forem criadas no futuro, e não pode ser excluído.
            </span>
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor="role-name" className="sr-only">
              Nome do papel
            </label>
            <Input
              id="role-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              disabled={locked}
              placeholder="Nome do papel (ex.: Balcão, Mecânico chefe)"
              className="h-10 text-base font-semibold"
              maxLength={40}
            />
            <label htmlFor="role-desc" className="sr-only">
              Descrição
            </label>
            <Textarea
              id="role-desc"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              disabled={locked}
              placeholder="Para quem é este papel? (opcional)"
              className="min-h-14 resize-none text-sm"
              maxLength={280}
            />
          </div>
          {role && canManage && (
            <div className="flex shrink-0 gap-1.5 sm:flex-col">
              <Button variant="outline" size="sm" onClick={() => onDuplicate({ name: `${role.name} (cópia)`, description: role.description ?? '', permissions: role.permissions })}>
                <Copy /> Duplicar
              </Button>
              {!role.isSystem && (
                <Button variant="ghost" size="sm" className="text-destructive hover:bg-red-50 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Excluir
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        {catalog.groups.map((g) => {
          const cov = coverage(g, granted);
          const keys = g.permissions.map((p) => p.key);
          return (
            <fieldset key={g.key} className="overflow-hidden rounded-lg border">
              <legend className="sr-only">{g.label}</legend>
              <div className="flex items-center gap-3 bg-muted/50 px-3.5 py-2.5">
                <Checkbox
                  aria-label={`Todas as permissões de ${g.label}`}
                  checked={cov.state}
                  disabled={locked}
                  onCheckedChange={() => set(keys, cov.state !== true)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{g.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{g.description}</p>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular', cov.on === cov.total ? 'bg-emerald-100 text-emerald-800' : cov.on ? 'bg-amber-100 text-amber-900' : 'bg-muted text-muted-foreground')}>
                  {cov.on}/{cov.total}
                </span>
              </div>
              <ul className="divide-y">
                {g.permissions.map((p) => {
                  const on = granted.has(p.key);
                  const id = `perm-${role?.id ?? 'new'}-${p.key}`;
                  const changed = change.added.includes(p.key) || change.removed.includes(p.key);
                  return (
                    <li key={p.key} className={cn('flex items-center gap-3 px-3.5 py-2.5 transition-colors', changed && role && 'bg-brand-soft/50')}>
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                        <span className="flex flex-wrap items-center gap-1.5 text-sm">
                          {p.label}
                          {p.risk === 'high' && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] font-semibold tracking-wide text-amber-900 uppercase">
                              <ShieldAlert aria-hidden className="size-3" /> sensível
                            </span>
                          )}
                        </span>
                        <code className="text-[11px] text-muted-foreground">{p.key}</code>
                      </label>
                      <Switch id={id} checked={on} disabled={locked} onCheckedChange={(v) => set([p.key], v)} />
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>

      {canManage && !role?.isSystem && dirty && (
        <div className="sticky bottom-20 z-10 mx-3 mb-3 flex animate-rise items-center gap-3 rounded-xl border bg-brand-secondary px-4 py-3 text-white shadow-xl sm:bottom-4">
          <p className="min-w-0 flex-1 truncate text-sm">
            {role ? (
              <>
                <span className="font-medium">Alterações não salvas</span>
                <span className="text-white/70">
                  {change.added.length > 0 && ` · +${change.added.length}`}
                  {change.removed.length > 0 && ` · −${change.removed.length}`}
                  {role.memberCount > 0 && ` · afeta ${role.memberCount} pessoa(s)`}
                </span>
              </>
            ) : (
              <span className="font-medium">Novo papel · {draft.permissions.length} permissão(ões)</span>
            )}
          </p>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => (role ? setDraft(seed) : onCancel())}>
            {role ? 'Descartar' : 'Cancelar'}
          </Button>
          <Button size="sm" onClick={save} disabled={pending || draft.name.trim().length < 2}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} {role ? 'Salvar' : 'Criar papel'}
          </Button>
        </div>
      )}

      {role && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir o papel &quot;{role.name}&quot;?</AlertDialogTitle>
              <AlertDialogDescription>
                {role.memberCount > 0
                  ? `${role.memberCount} pessoa(s) perdem este papel e as permissões que vinham só dele. Não dá para desfazer.`
                  : 'Ninguém usa este papel agora. Não dá para desfazer.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={async () => {
                  try {
                    await actions.deleteRole.mutateAsync(role.id);
                    toast({ title: `Papel "${role.name}" excluído` });
                  } catch (err) {
                    toast({ title: errorText(err), tone: 'error' });
                  }
                }}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
