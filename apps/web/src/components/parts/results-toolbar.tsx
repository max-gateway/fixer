'use client';

import { LayoutGrid, List, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AVAILABILITY_LABEL, type ActiveFilter, type Availability } from '@/lib/part-search';
import { cn } from '@/lib/utils';
import type { CardView } from './part-card';

/**
 * Onde procurar, num controle só: o catálogo inteiro (cada peça diz o que a oficina tem dela), só o que a oficina cadastrou, ou só o que tem saldo.
 * Com veículo escolhido não vale (a oficina não sabe em que veículo cada peça dela serve; isso é do catálogo): fica desabilitado e diz por quê.
 */
export function AvailabilityFilter({ value, onChange, disabled }: { value: Availability; onChange: (v: Availability) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Onde procurar" title={disabled ? 'Com veículo escolhido a lista é do catálogo; o saldo aparece em cada peça' : undefined} className={cn('inline-flex rounded-lg border bg-card p-0.5 text-sm', disabled && 'opacity-50')}>
      {(['all', 'mine', 'stock'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => value !== v && onChange(v)}
          className={cn('rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed', value === v ? 'bg-brand text-primary-foreground' : 'text-muted-foreground enabled:hover:text-foreground')}
        >
          {AVAILABILITY_LABEL[v]}
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
