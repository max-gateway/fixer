'use client';

import { Crown, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { roleStyle, STATUS_META } from '../model';
import type { MemberStatus, Role } from '../types';

/** Papel como etiqueta colorida (cor estável pelo nome; Admin na cor da marca). */
export function RoleChip({ role, className }: { role: Pick<Role, 'name' | 'isSystem'>; className?: string }) {
  return (
    <span style={roleStyle(role)} className={cn('inline-flex max-w-40 items-center gap-1 truncate rounded-md border px-1.5 py-px text-xs font-medium', className)}>
      {role.isSystem && <Crown aria-hidden className="size-3 shrink-0" />}
      <span className="truncate">{role.name}</span>
    </span>
  );
}

export function StatusPill({ status, className }: { status: MemberStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span title={meta.hint} className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', meta.chip, className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', meta.dot, status === 'invited' && 'animate-pulse')} />
      {meta.label}
    </span>
  );
}

export function ManagerMark() {
  return (
    <span title="Administra os acessos" className="inline-flex items-center text-brand">
      <ShieldCheck aria-hidden className="size-3.5" />
      <span className="sr-only">administra os acessos</span>
    </span>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{children}</h3>
      {aside}
    </div>
  );
}

/** Estado vazio com ilustração leve (anéis concêntricos na cor da marca). */
export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="relative grid size-16 place-items-center">
        <span aria-hidden className="absolute inset-0 rounded-full bg-brand-soft" />
        <span aria-hidden className="absolute inset-2 rounded-full bg-card ring-1 ring-border" />
        <span className="relative text-brand [&_svg]:size-6">{icon}</span>
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Mensagem de erro de API pronta para o usuário. */
export const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'Algo deu errado. Tente de novo.');
