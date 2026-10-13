'use client';

import { ArrowDownAZ, ArrowDownWideNarrow, Building2, Calendar, Check, ChevronDown, Download, Layers, ListFilter, Search, Tag, X } from 'lucide-react';
import { forwardRef, useEffect, useMemo, useState, type ReactNode, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  activeFilterCount,
  civilDate,
  filtersToParams,
  money,
  VIEWS,
  VIEW_LABEL,
  type Filters,
  type GroupBy,
  type Sort,
  type Summary,
  type Supplier,
} from '@/lib/payables';
import { cn } from '@/lib/utils';

const GROUP_LABEL: Record<GroupBy, string> = { due: 'Por vencimento', supplier: 'Por fornecedor', none: 'Sem agrupar' };
const SORT_LABEL: Record<Sort, string> = { due: 'Vencimento', amount: 'Valor', supplier: 'Fornecedor', paid: 'Data do pagamento' };
const SOURCE_LABEL = { '': 'Todas as origens', nfe: 'Notas fiscais (XML)', manual: 'Lançadas à mão' } as const;

export function Toolbar({
  filters,
  summary,
  suppliers,
  categories,
  today,
  searchRef,
  onChange,
}: {
  filters: Filters;
  summary: Summary;
  suppliers: Supplier[];
  categories: string[];
  today: string;
  searchRef: Ref<HTMLInputElement>;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const active = activeFilterCount(filters);
  return (
    <div className="space-y-3">
      <nav aria-label="Situação das contas" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange({ view: v, sort: v === 'paid' ? 'paid' : filters.sort === 'paid' ? 'due' : filters.sort, dir: v === 'paid' ? 'desc' : 'asc' })}
            aria-current={v === filters.view ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
              v === filters.view ? 'border-brand bg-brand text-white' : 'bg-card hover:bg-muted',
            )}
          >
            {VIEW_LABEL[v]}
            <span className={cn('tabular text-xs', v === filters.view ? 'text-white/85' : 'text-muted-foreground')}>{summary.views[v].count}</span>
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={filters.q} inputRef={searchRef} onCommit={(q) => onChange({ q })} />

        <PickerChip
          icon={<Building2 aria-hidden />}
          label="Fornecedor"
          value={filters.supplier}
          onClear={() => onChange({ supplier: '' })}
          options={suppliers.map((s) => ({ value: s.name, label: s.name, hint: s.openCount ? `${money(s.openAmount)} em aberto` : 'nada em aberto' }))}
          onPick={(supplier) => onChange({ supplier })}
          searchPlaceholder="Buscar fornecedor"
          empty="Nenhum fornecedor ainda"
        />
        <PickerChip
          icon={<Tag aria-hidden />}
          label="Categoria"
          value={filters.category}
          onClear={() => onChange({ category: '' })}
          options={categories.map((c) => ({ value: c, label: c }))}
          onPick={(category) => onChange({ category })}
          searchPlaceholder="Buscar categoria"
          empty="Nenhuma categoria"
        />
        <OriginChip value={filters.source} onChange={(source) => onChange({ source })} />
        <PeriodChip from={filters.from} to={filters.to} today={today} onChange={(from, to) => onChange({ from, to })} />

        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ supplier: '', category: '', source: '', from: '', to: '' })}>
            <X aria-hidden /> Limpar filtros
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <MenuChip
            icon={<Layers aria-hidden />}
            label={GROUP_LABEL[filters.group]}
            ariaLabel="Agrupar por"
            items={(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => ({ key: g, label: GROUP_LABEL[g], selected: g === filters.group }))}
            onPick={(g) => onChange({ group: g as GroupBy })}
          />
          <MenuChip
            icon={filters.sort === 'supplier' ? <ArrowDownAZ aria-hidden /> : <ArrowDownWideNarrow aria-hidden />}
            label={`${SORT_LABEL[filters.sort]} ${filters.dir === 'asc' ? '↑' : '↓'}`}
            ariaLabel="Ordenar por"
            items={(['due', 'amount', 'supplier', 'paid'] as Sort[]).map((s) => ({ key: s, label: SORT_LABEL[s], selected: s === filters.sort }))}
            footer={{ label: filters.dir === 'asc' ? 'Inverter: do maior para o menor' : 'Inverter: do menor para o maior', onClick: () => onChange({ dir: filters.dir === 'asc' ? 'desc' : 'asc' }) }}
            onPick={(s) => onChange({ sort: s as Sort })}
          />
          <a
            href={`/api/payables/export?${filtersToParams({ ...filters, sort: 'due', dir: 'asc' }, { forApi: true })}`}
            className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            title="Baixar as contas filtradas em CSV (abre no Excel)"
          >
            <Download aria-hidden className="size-4" /> <span className="hidden sm:inline">Exportar</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function SearchBox({ value, inputRef, onCommit }: { value: string; inputRef: Ref<HTMLInputElement>; onCommit: (q: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  // Debounce: filtra enquanto digita sem uma requisição por tecla.
  useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => onCommit(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text, value, onCommit]);
  return (
    <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (setText(''), onCommit(''), e.currentTarget.blur())}
        placeholder="Buscar fornecedor, documento, descrição"
        aria-label="Buscar contas"
        className="pl-9"
      />
    </div>
  );
}

const Chip = forwardRef<HTMLButtonElement, { icon: ReactNode; children: ReactNode; active?: boolean } & React.ComponentProps<'button'>>(function Chip(
  { icon, children, active, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex h-9 max-w-[16rem] items-center gap-2 rounded-md border px-3 text-sm font-medium shadow-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        '[&_svg:not([class*=size-])]:size-4 [&_svg]:shrink-0',
        active ? 'border-brand/50 bg-brand-soft text-foreground' : 'bg-background hover:bg-accent',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="truncate">{children}</span>
      <ChevronDown aria-hidden className="size-3.5 opacity-60" />
    </button>
  );
});

type Option = { value: string; label: string; hint?: string };

/** Filtro de uma dimensão com busca e lista (fornecedor, categoria). Clicar na opção marcada limpa. */
function PickerChip({
  icon,
  label,
  value,
  options,
  onPick,
  onClear,
  searchPlaceholder,
  empty,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  options: Option[];
  onPick: (v: string) => void;
  onClear: () => void;
  searchPlaceholder: string;
  empty: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50), [options, q]);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <Chip icon={icon} active={!!value}>
          {value ? `${label}: ${value}` : label}
        </Chip>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="mb-2 h-8" autoFocus />
        <ul role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
          {shown.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted-foreground">{q ? 'Nada encontrado' : empty}</li>}
          {shown.map((o) => {
            const selected = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    selected ? onClear() : onPick(o.value);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <Check aria-hidden className={cn('size-4 shrink-0', selected ? 'text-brand' : 'opacity-0')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function OriginChip({ value, onChange }: { value: Filters['source']; onChange: (v: Filters['source']) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip icon={<ListFilter aria-hidden />} active={!!value}>
          {value ? SOURCE_LABEL[value] : 'Origem'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1.5">
        {(Object.keys(SOURCE_LABEL) as (keyof typeof SOURCE_LABEL)[]).map((k) => (
          <button
            key={k || 'all'}
            type="button"
            onClick={() => {
              onChange(k);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            <Check aria-hidden className={cn('size-4', k === value ? 'text-brand' : 'opacity-0')} />
            {SOURCE_LABEL[k]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
function monthRange(today: string, offset: number): [string, string] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1 + offset, 1));
  const end = new Date(Date.UTC(y, m + offset, 0));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

function PeriodChip({ from, to, today, onChange }: { from: string; to: string; today: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = from || to ? `${from ? civilDate(`${from}T00:00:00Z`) : '…'} a ${to ? civilDate(`${to}T00:00:00Z`) : '…'}` : 'Vencimento';
  const presets: { label: string; range: [string, string] }[] = [
    { label: 'Este mês', range: monthRange(today, 0) },
    { label: 'Próximo mês', range: monthRange(today, 1) },
    { label: 'Próximos 30 dias', range: [today, addDays(today, 30)] },
    { label: 'Últimos 30 dias', range: [addDays(today, -30), today] },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip icon={<Calendar aria-hidden />} active={!!(from || to)}>
          {label}
        </Chip>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onChange(...p.range);
                setOpen(false);
              }}
              className="rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            De
            <Input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} className="mt-1 h-9" />
          </label>
          <label className="text-xs text-muted-foreground">
            Até
            <Input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} className="mt-1 h-9" />
          </label>
        </div>
        {(from || to) && (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange('', '')}>
            Limpar período
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuChip({
  icon,
  label,
  ariaLabel,
  items,
  footer,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  ariaLabel: string;
  items: { key: string; label: string; selected: boolean }[];
  footer?: { label: string; onClick: () => void };
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip icon={icon} aria-label={`${ariaLabel}: ${label}`}>
          <span className="hidden sm:inline">{label}</span>
        </Chip>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{ariaLabel}</p>
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={() => {
              onPick(i.key);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            <Check aria-hidden className={cn('size-4', i.selected ? 'text-brand' : 'opacity-0')} />
            {i.label}
          </button>
        ))}
        {footer && (
          <button type="button" onClick={footer.onClick} className="mt-1 w-full rounded-md border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
            {footer.label}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
