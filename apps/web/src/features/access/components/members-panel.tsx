'use client';

import { ChevronRight, Search, UserRoundSearch, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { UserAvatar } from '@/components/nav/user-avatar';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { countByStatus, filterMembers, relative, STATUS_META, STATUS_ORDER, type MemberFilter } from '../model';
import type { Catalog, DirectoryState, Member, Role } from '../types';
import { EmptyState, ManagerMark, RoleChip, StatusPill } from './bits';
import { MemberSheet } from './member-sheet';

type Props = {
  members: Member[];
  roles: Role[];
  catalog: Catalog;
  filter: MemberFilter;
  onFilter: (f: MemberFilter) => void;
  canManage: boolean;
  directory: DirectoryState;
};

export function MembersPanel({ members, roles, catalog, filter, onFilter, canManage, directory }: Props) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  const visible = useMemo(() => filterMembers(members, filter), [members, filter]);
  const counts = useMemo(() => countByStatus(members), [members]);
  const rolesById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const open = members.find((m) => m.sub === openSub) ?? null;
  const filtered = filter.q || filter.status !== 'all' || filter.roleId !== 'all';

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter.q} onChange={(e) => onFilter({ ...filter, q: e.target.value })} placeholder="Buscar por nome ou e-mail" aria-label="Buscar pessoas" className="h-10 pl-9" />
        </div>
        <Select value={filter.roleId} onChange={(e) => onFilter({ ...filter, roleId: e.target.value })} aria-label="Filtrar por papel" className="h-10 sm:w-52">
          <option value="all">Todos os papéis</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>

      <nav aria-label="Situação" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
        {(['all', ...STATUS_ORDER] as const)
          .filter((s) => s === 'all' || counts[s] > 0 || filter.status === s)
          .map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onFilter({ ...filter, status: s })}
              aria-pressed={filter.status === s}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                filter.status === s ? 'border-brand bg-brand text-white' : 'bg-card hover:bg-muted',
              )}
            >
              {s !== 'all' && <span aria-hidden className={cn('size-1.5 rounded-full', filter.status === s ? 'bg-white' : STATUS_META[s].dot)} />}
              {s === 'all' ? 'Todas' : STATUS_META[s].label}
              <span className={cn('text-xs tabular', filter.status === s ? 'text-white/85' : 'text-muted-foreground')}>{counts[s]}</span>
            </button>
          ))}
        {filtered && (
          <button type="button" onClick={() => onFilter({ q: '', status: 'all', roleId: 'all' })} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground">
            <X aria-hidden className="size-3.5" /> Limpar
          </button>
        )}
      </nav>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {visible.length === 0 ? (
          <EmptyState icon={<UserRoundSearch />} title={filtered ? 'Ninguém com esses filtros' : 'Ninguém por aqui ainda'}>
            {filtered ? 'Tente outra busca ou limpe os filtros.' : canManage && directory.status === 'ok' ? 'Convide a equipe da oficina pelo botão "Convidar pessoa".' : null}
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {visible.map((m, i) => (
              <li key={m.sub} className="animate-rise" style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}>
                <button
                  type="button"
                  onClick={() => setOpenSub(m.sub)}
                  className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none sm:gap-4"
                >
                  <UserAvatar name={m.name} className={cn('size-10 text-sm', (m.status === 'inactive' || m.status === 'blocked') && 'opacity-50 grayscale')} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      <span className="truncate">{m.name}</span>
                      {m.isSelf && <span className="rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">você</span>}
                      {m.isManager && <ManagerMark />}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{m.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1 sm:hidden">
                      <StatusPill status={m.status} />
                    </div>
                  </div>
                  <div className="hidden max-w-[40%] flex-wrap justify-end gap-1 md:flex">
                    {m.roleIds.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">sem papel</span>
                    ) : (
                      m.roleIds.slice(0, 3).map((id) => rolesById.get(id) && <RoleChip key={id} role={rolesById.get(id)!} />)
                    )}
                    {m.roleIds.length > 3 && <span className="text-xs text-muted-foreground">+{m.roleIds.length - 3}</span>}
                  </div>
                  <div className="hidden w-32 shrink-0 flex-col items-end gap-1 sm:flex">
                    <StatusPill status={m.status} />
                    <span className="text-xs text-muted-foreground" title={m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString('pt-BR') : undefined}>
                      {m.lastSeenAt ? `visto ${relative(m.lastSeenAt)}` : m.status === 'unlinked' ? 'no diretório' : 'nunca entrou'}
                    </span>
                  </div>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MemberSheet member={open} roles={roles} catalog={catalog} canManage={canManage} onClose={() => setOpenSub(null)} />
    </div>
  );
}
