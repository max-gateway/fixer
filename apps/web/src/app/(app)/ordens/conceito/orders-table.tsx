'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Plate, StatusBadge } from '@/components/orders/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { brl0, orderTotal, sinceLabel, type MockOrder } from './mock-data';
import { DueChip, MechanicAvatar, PriorityMark, Signals } from './order-bits';

type SortKey = 'number' | 'due' | 'total' | 'updated';

const SORTERS: Record<SortKey, (a: MockOrder, b: MockOrder) => number> = {
  number: (a, b) => a.number - b.number,
  due: (a, b) => (a.promisedAt ? Date.parse(a.promisedAt) : Infinity) - (b.promisedAt ? Date.parse(b.promisedAt) : Infinity),
  total: (a, b) => orderTotal(a) - orderTotal(b),
  updated: (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
};

type Props = {
  orders: MockOrder[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpen: (id: string) => void;
};

/** Lista densa para triagem em massa: ordena por prazo, valor ou última movimentação e seleciona várias de uma vez. */
export function OrdersTable({ orders, selected, onSelectedChange, onOpen }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'updated', dir: -1 });
  const rows = useMemo(() => [...orders].sort((a, b) => SORTERS[sort.key](a, b) * sort.dir), [orders, sort]);

  const allChecked = rows.length > 0 && rows.every((o) => selected.has(o.id));
  const someChecked = rows.some((o) => selected.has(o.id));

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    on ? next.add(id) : next.delete(id);
    onSelectedChange(next);
  }

  function head(key: SortKey, label: string, className?: string) {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <TableHead className={className} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => setSort({ key, dir: active ? (sort.dir === 1 ? -1 : 1) : key === 'total' || key === 'updated' ? -1 : 1 })}
          className={cn('inline-flex items-center gap-1 rounded hover:text-foreground', active && 'text-foreground')}
        >
          {label}
          <Icon aria-hidden className={cn('size-3', !active && 'opacity-40')} />
        </button>
      </TableHead>
    );
  }

  return (
    <div className="surface overflow-hidden rounded-2xl border bg-card">
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 pr-0 pl-4">
              <Checkbox
                aria-label="Selecionar todas"
                checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                onCheckedChange={(v) => onSelectedChange(v ? new Set(rows.map((o) => o.id)) : new Set())}
              />
            </TableHead>
            {head('number', 'Ordem')}
            <TableHead>Veículo</TableHead>
            <TableHead className="max-md:hidden">Cliente</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="max-lg:hidden">Serviço</TableHead>
            <TableHead className="max-sm:hidden">Equipe</TableHead>
            {head('due', 'Prazo', 'max-sm:hidden')}
            {head('updated', 'Movimento', 'max-xl:hidden')}
            {head('total', 'Total', 'text-right')}
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((o) => (
            <TableRow
              key={o.id}
              data-order-id={o.id}
              data-state={selected.has(o.id) ? 'selected' : undefined}
              tabIndex={0}
              onClick={() => onOpen(o.id)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onOpen(o.id);
                }
              }}
              className="group cursor-pointer outline-none focus-visible:bg-brand-soft/60"
            >
              <TableCell className="w-10 pr-0 pl-4" onClick={(e) => e.stopPropagation()}>
                <Checkbox aria-label={`Selecionar ordem ${o.number}`} checked={selected.has(o.id)} onCheckedChange={(v) => toggle(o.id, v === true)} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="tabular inline-flex items-center gap-1 font-semibold text-brand">
                  #{o.number}
                  <PriorityMark priority={o.priority} />
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Plate value={o.vehicle.plate} />
                  <span className="truncate font-medium max-sm:hidden">
                    {o.vehicle.brand} {o.vehicle.model}
                  </span>
                </div>
              </TableCell>
              <TableCell className="max-w-44 truncate max-md:hidden">{o.customer.name}</TableCell>
              <TableCell>
                <StatusBadge status={o.status} />
              </TableCell>
              <TableCell className="max-w-52 truncate text-slate-600 max-lg:hidden">
                {o.services[0]?.name}
                {o.services.length > 1 && <span className="ml-1 text-xs text-muted-foreground">+{o.services.length - 1}</span>}
              </TableCell>
              <TableCell className="max-sm:hidden">
                <div className="flex items-center gap-2">
                  <MechanicAvatar id={o.mechanicId} />
                  <Signals order={o} />
                </div>
              </TableCell>
              <TableCell className="max-sm:hidden">
                <DueChip order={o} />
              </TableCell>
              <TableCell className="tabular text-xs whitespace-nowrap text-muted-foreground max-xl:hidden">há {sinceLabel(o.updatedAt)}</TableCell>
              <TableCell className="tabular text-right font-semibold whitespace-nowrap">{brl0(orderTotal(o))}</TableCell>
              <TableCell className="w-8 pl-0">
                <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
