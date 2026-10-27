'use client';

import { Car, LayoutGrid, List, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ActiveFilter } from '@/lib/part-search';
import { cn } from '@/lib/utils';
import type { CardView } from './part-card';

/** Catálogo global x peças que a oficina já cadastrou. */
export function ModeSwitch({ mine, onChange }: { mine: boolean; onChange: (mine: boolean) => void }) {
  return (
    <div role="group" aria-label="Onde buscar" className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
      {(
        [
          [false, 'Catálogo'],
          [true, 'Minha oficina'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={label}
          type="button"
          aria-pressed={mine === value}
          onClick={() => mine !== value && onChange(value)}
          className={cn('rounded-md px-3 py-1 font-medium transition-colors', mine === value ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ViewToggle({ view, onChange }: { view: CardView; onChange: (view: CardView) => void }) {
  return (
    <div role="group" aria-label="Modo de exibição" className="flex rounded-lg border bg-card p-0.5">
      {(
        [
          ['list', List, 'Lista'],
          ['grid', LayoutGrid, 'Grade'],
        ] as const
      ).map(([v, Icon, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          aria-label={label}
          title={`${label} (v)`}
          className={cn('grid size-7 place-items-center rounded-md text-muted-foreground transition-colors', view === v ? 'bg-brand text-primary-foreground' : 'hover:text-foreground')}
        >
          <Icon aria-hidden className="size-4" />
        </button>
      ))}
    </div>
  );
}

export function FiltersButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="lg:hidden" onClick={onClick}>
      <SlidersHorizontal aria-hidden /> Filtros{count > 0 && <span className="rounded-full bg-brand px-1.5 text-[0.65rem] text-primary-foreground">{count}</span>}
    </Button>
  );
}

/** "Só com saldo": filtro do modo Minha oficina. */
export function StockToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn('inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors', on ? 'border-brand bg-brand-soft text-brand' : 'bg-card text-muted-foreground hover:text-foreground')}
    >
      <span aria-hidden className={cn('size-2 rounded-full', on ? 'bg-brand' : 'bg-muted-foreground/40')} />
      Só com saldo
    </button>
  );
}

/** Filtros ativos como chips removíveis. */
export function ActiveFilters({ filters, onRemove, onClear }: { filters: ActiveFilter[]; onRemove: (kind: ActiveFilter['kind'], value: string) => void; onClear: () => void }) {
  if (filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <button
          key={`${f.kind}:${f.value}`}
          type="button"
          onClick={() => onRemove(f.kind, f.value)}
          className="group inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pr-2 pl-3 text-xs font-medium hover:border-destructive/40 hover:text-destructive"
        >
          {f.kind === 'vehicle' && <Car aria-hidden className="size-3.5" />}
          {f.label}
          <X aria-label="Remover filtro" className="size-3.5 text-muted-foreground group-hover:text-destructive" />
        </button>
      ))}
      <button type="button" onClick={onClear} className="px-1 text-xs font-medium text-brand hover:underline">
        Limpar tudo
      </button>
    </div>
  );
}
