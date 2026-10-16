'use client';

import { Check, CircleDashed, FileClock, PackageCheck, ScanSearch } from 'lucide-react';
import type { ComponentType } from 'react';
import { SIDE_VIEWS, STAGE_HINT, STAGES, VIEW_LABEL, type View } from '@/lib/invoices';
import { cn } from '@/lib/utils';

const ICON: Record<(typeof STAGES)[number], ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  summary: FileClock,
  pending: ScanSearch,
  ready: PackageCheck,
  posted: Check,
};

/**
 * O caminho de uma nota, da chegada ao estoque. Cada etapa é um filtro; a barra embaixo mostra onde está o acúmulo,
 * então dá para ver de relance qual etapa precisa de atenção.
 */
export function Pipeline({ view, counts, onView }: { view: View; counts: Record<View, number>; onView: (v: View) => void }) {
  const flow = STAGES.reduce((n, s) => n + counts[s], 0);
  return (
    <div className="space-y-2">
      <nav aria-label="Etapas das notas" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {STAGES.map((s, i) => {
          const Icon = ICON[s];
          const active = view === s;
          const n = counts[s];
          const attention = s !== 'posted' && n > 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onView(s)}
              aria-current={active ? 'page' : undefined}
              title={STAGE_HINT[s]}
              className={cn(
                'group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border bg-card px-3.5 py-3 text-left shadow-xs transition-all',
                'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                active ? 'border-brand ring-1 ring-brand/40' : 'hover:-translate-y-px hover:border-foreground/25 hover:shadow-sm',
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-lg transition-colors',
                  active ? 'bg-brand text-white' : attention ? 'bg-brand-soft text-brand' : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon aria-hidden className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="tabular block text-xl leading-none font-semibold">{n}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{VIEW_LABEL[s]}</span>
              </span>
              <kbd className="ml-auto hidden rounded border bg-muted/60 px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground xl:group-hover:inline-block">{i + 1}</kbd>
            </button>
          );
        })}
      </nav>

      {flow > 0 && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={STAGES.map((s) => `${VIEW_LABEL[s]}: ${counts[s]}`).join(', ')}>
          {STAGES.map((s) => (
            <span
              key={s}
              style={{ width: `${(counts[s] / flow) * 100}%` }}
              className={cn('h-full transition-[width] duration-500', s === 'summary' && 'bg-amber-400', s === 'pending' && 'bg-brand', s === 'ready' && 'bg-emerald-500', s === 'posted' && 'bg-foreground/20')}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 text-sm">
        <CircleDashed aria-hidden className="mr-1 size-3.5 text-muted-foreground" />
        {SIDE_VIEWS.map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            aria-current={view === v ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
              view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {VIEW_LABEL[v]}
            <span className="tabular opacity-70">{counts[v]}</span>
            <span className="sr-only">atalho {STAGES.length + i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
