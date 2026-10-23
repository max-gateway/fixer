'use client';

import { History, KeyRound, Loader2, Mail, MailPlus, Power, PowerOff, ShieldPlus, Trash2, UserCog, UserMinus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAudit } from '../hooks';
import { auditSentence, relative } from '../model';
import type { AuditItem, Catalog } from '../types';
import { EmptyState } from './bits';

const ICON: Record<string, { icon: LucideIcon; tone: string }> = {
  'member.invited': { icon: MailPlus, tone: 'bg-sky-100 text-sky-800' },
  'member.linked': { icon: ShieldPlus, tone: 'bg-emerald-100 text-emerald-800' },
  'member.roles_changed': { icon: UserCog, tone: 'bg-violet-100 text-violet-800' },
  'member.deactivated': { icon: PowerOff, tone: 'bg-amber-100 text-amber-900' },
  'member.reactivated': { icon: Power, tone: 'bg-emerald-100 text-emerald-800' },
  'member.removed': { icon: UserMinus, tone: 'bg-red-100 text-red-800' },
  'member.setup_email': { icon: Mail, tone: 'bg-sky-100 text-sky-800' },
  'role.created': { icon: KeyRound, tone: 'bg-emerald-100 text-emerald-800' },
  'role.updated': { icon: KeyRound, tone: 'bg-violet-100 text-violet-800' },
  'role.deleted': { icon: Trash2, tone: 'bg-red-100 text-red-800' },
};

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

/** Linha do tempo de quem mudou o quê, agrupada por dia. */
export function AuditPanel({ catalog }: { catalog: Catalog }) {
  const audit = useAudit();
  const items = audit.data?.pages.flatMap((p) => p.items) ?? [];

  if (audit.isLoading) {
    return (
      <div className="space-y-3 rounded-xl border bg-card surface p-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (audit.isError) return <p className="rounded-xl border bg-card surface p-5 text-sm text-red-800">Não foi possível carregar o histórico.</p>;
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState icon={<History />} title="Nada registrado ainda">
          Convites, mudanças de papel e de permissões aparecem aqui, com quem fez e quando.
        </EmptyState>
      </div>
    );
  }

  const days: { label: string; items: AuditItem[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.at);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)!.items.push(it);
  }

  return (
    <div className="space-y-5 rounded-xl border bg-card surface p-4 shadow-xs sm:p-5">
      {days.map((day) => (
        <section key={day.label}>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{day.label}</h3>
          <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
            {day.items.map((it) => {
              const meta = ICON[it.action] ?? { icon: History, tone: 'bg-muted text-muted-foreground' };
              const Icon = meta.icon;
              const s = auditSentence(it, catalog);
              return (
                <li key={it.id} className="relative flex gap-3">
                  <span className={cn('relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-card', meta.tone)}>
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-sm">{s.title}</p>
                    {s.detail && <p className="mt-0.5 text-xs break-words text-muted-foreground">{s.detail}</p>}
                  </div>
                  <time dateTime={it.at} title={new Date(it.at).toLocaleString('pt-BR')} className="shrink-0 pt-1 text-xs text-muted-foreground">
                    {new Date(it.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    <span className="sr-only"> ({relative(it.at)})</span>
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {audit.hasNextPage && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
            {audit.isFetchingNextPage && <Loader2 className="animate-spin" />} Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}
