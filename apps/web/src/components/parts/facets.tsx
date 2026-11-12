'use client';

import { ChevronDown, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { Facets } from '@/lib/part-search';

const COLLAPSED = 7;
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

type Option = { value: string; name: string; count: number };

/** Um grupo de filtros com contagem. Os marcados sobem para o topo; passando de 7 opções aparece o campo para filtrar a lista. */
function FacetGroup({ title, options, selected, onToggle }: { title: string; options: Option[]; selected: string[]; onToggle: (value: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  if (options.length === 0 && selected.length === 0) return null;

  const known = new Set(options.map((o) => o.value));
  // Filtro marcado que a busca atual não devolve mais (contagem zero) continua visível para a pessoa poder desmarcar.
  const all = [...options, ...selected.filter((v) => !known.has(v)).map((v) => ({ value: v, name: v, count: 0 }))];
  const sorted = [...all].sort((a, b) => Number(selected.includes(b.value)) - Number(selected.includes(a.value)) || b.count - a.count);
  const matching = filter ? sorted.filter((o) => norm(o.name).includes(norm(filter))) : sorted;
  const shown = open || filter ? matching : matching.slice(0, COLLAPSED);
  const max = Math.max(1, ...all.map((o) => o.count));

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 flex w-full items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
        {selected.length > 0 && <span className="rounded-full bg-brand px-1.5 text-[0.65rem] text-primary-foreground normal-case">{selected.length}</span>}
      </legend>
      {all.length > COLLAPSED && (
        <label className="relative block">
          <span className="sr-only">Filtrar {title.toLowerCase()}</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filtrar ${title.toLowerCase()}`}
            className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
          />
        </label>
      )}
      <ul className="space-y-0.5">
        {shown.map((o) => {
          const checked = selected.includes(o.value);
          const cid = `${id}-${o.value}`;
          return (
            <li key={o.value}>
              <label htmlFor={cid} className={cn('relative flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 text-sm hover:bg-accent/70', checked && 'bg-accent')}>
                {/* Barra proporcional ao número de peças: dá a leitura do tamanho de cada marca/categoria de relance. */}
                <span aria-hidden className="absolute inset-y-0 left-0 bg-brand/[0.06]" style={{ width: `${(o.count / max) * 100}%` }} />
                <Checkbox id={cid} checked={checked} onCheckedChange={() => onToggle(o.value)} className="relative" />
                <span className="relative min-w-0 flex-1 truncate">{o.name}</span>
                <span className="tabular relative text-xs text-muted-foreground">{o.count.toLocaleString('pt-BR')}</span>
              </label>
            </li>
          );
        })}
        {matching.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">Nada com “{filter}”.</li>}
      </ul>
      {!filter && matching.length > COLLAPSED && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 px-2 text-xs font-medium text-brand hover:underline">
          <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          {open ? 'Ver menos' : `Ver todas (${matching.length})`}
        </button>
      )}
    </fieldset>
  );
}

/** Filtros por marca e categoria, calculados pela plataforma sobre TODAS as peças que casaram (não só a página). */
export function FacetPanel({
  facets,
  brands,
  categories,
  onToggleBrand,
  onToggleCategory,
}: {
  facets: Facets | undefined;
  brands: string[];
  categories: string[];
  onToggleBrand: (key: string) => void;
  onToggleCategory: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <FacetGroup title="Marcas" options={(facets?.brands ?? []).map((b) => ({ value: b.key, name: b.name, count: b.count }))} selected={brands} onToggle={onToggleBrand} />
      <FacetGroup title="Categorias" options={(facets?.categories ?? []).map((c) => ({ value: c.id, name: c.name, count: c.count }))} selected={categories} onToggle={onToggleCategory} />
    </div>
  );
}
