'use client';

import { Check, Crown, Minus } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { useAccessActions } from '../hooks';
import { roleStyle } from '../model';
import type { Catalog, Role } from '../types';
import { errorText } from './bits';

/**
 * Visão de cima: permissões nas linhas, papéis nas colunas. Quem administra liga/desliga direto na célula
 * (salva na hora, com "Desfazer" no aviso). O Admin fica travado.
 */
export function PermissionMatrix({ roles, catalog, canManage, onOpenRole }: { roles: Role[]; catalog: Catalog; canManage: boolean; onOpenRole: () => void }) {
  const { toast } = useToast();
  const { updateRole } = useAccessActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);

  const toggle = async (role: Role, key: string, label: string) => {
    const on = role.permissions.includes(key);
    const next = on ? role.permissions.filter((k) => k !== key) : [...role.permissions, key];
    const cell = `${role.id}:${key}`;
    setBusy(cell);
    try {
      await updateRole.mutateAsync({ id: role.id, permissions: next });
      toast({
        title: `${role.name}: ${on ? 'sem' : 'com'} "${label}"`,
        action: { label: 'Desfazer', onClick: () => updateRole.mutate({ id: role.id, permissions: role.permissions }) },
      });
    } catch (err) {
      toast({ title: errorText(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Permissões de cada papel</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Permissão
              </th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className={cn('px-2 py-3 text-center align-bottom transition-colors', hoverCol === r.id && 'bg-muted/60')} onMouseEnter={() => setHoverCol(r.id)} onMouseLeave={() => setHoverCol(null)}>
                  <button type="button" onClick={onOpenRole} className="inline-flex max-w-28 items-center gap-1 truncate rounded-md border px-2 py-0.5 text-xs font-semibold" style={roleStyle(r)} title={`Abrir o papel ${r.name}`}>
                    {r.isSystem && <Crown aria-hidden className="size-3 shrink-0" />}
                    <span className="truncate">{r.name}</span>
                  </button>
                  <div className="mt-1 text-[11px] font-normal text-muted-foreground tabular">{r.memberCount} pess.</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.groups.map((g) => (
              <Fragment key={g.key}>
                <tr className="bg-muted/40">
                  <th scope="colgroup" colSpan={roles.length + 1} className="sticky left-0 px-4 py-1.5 text-left text-xs font-semibold">
                    {g.label}
                  </th>
                </tr>
                {g.permissions.map((p) => (
                  <tr key={p.key} className="group border-b last:border-0 hover:bg-muted/30">
                    <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-normal group-hover:bg-muted/30">
                      <span className="block max-w-72 truncate" title={p.label}>
                        {p.label}
                      </span>
                      <code className="text-[11px] text-muted-foreground">{p.key}</code>
                    </th>
                    {roles.map((r) => {
                      const on = r.permissions.includes(p.key);
                      const editable = canManage && !r.isSystem;
                      const cell = `${r.id}:${p.key}`;
                      return (
                        <td key={r.id} className={cn('px-2 py-2 text-center transition-colors', hoverCol === r.id && 'bg-muted/60')} onMouseEnter={() => setHoverCol(r.id)} onMouseLeave={() => setHoverCol(null)}>
                          <button
                            type="button"
                            disabled={!editable || busy !== null}
                            onClick={() => toggle(r, p.key, p.label)}
                            aria-pressed={on}
                            aria-label={`${p.label} para ${r.name}`}
                            className={cn(
                              'mx-auto grid size-7 place-items-center rounded-md transition-all focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                              on ? 'text-white shadow-xs' : 'text-muted-foreground/40',
                              editable && 'hover:scale-110 hover:ring-1 hover:ring-foreground/20',
                              !editable && 'cursor-default',
                              busy === cell && 'animate-pulse',
                            )}
                            style={on ? { backgroundColor: roleStyle(r).color } : undefined}
                          >
                            {on ? <Check aria-hidden className="size-4" /> : <Minus aria-hidden className="size-3.5" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Clique numa célula para ligar ou desligar. A mudança vale na hora para todas as pessoas com aquele papel.</p>}
    </div>
  );
}
