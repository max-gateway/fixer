'use client';

import { cn } from '@/lib/utils';
import { MECHANICS, situation, type MockOrder } from './mock-data';
import { ChecklistBar, DueChip, Initials, PlateMark, StatusLabel } from './order-bits';

const ON_FLOOR = ['APPROVED', 'IN_PROGRESS', 'AWAITING_PART'];

type Props = { orders: MockOrder[]; recentlyMovedId: string | null; onOpen: (id: string) => void };

/**
 * Painel da oficina: o que cada mecânico tem no pátio agora, em letra grande (serve para a TV da oficina).
 * Só carros fisicamente na oficina; orçamento e pronto ficam na visão por situação.
 */
export function MechanicBoard({ orders, recentlyMovedId, onOpen }: Props) {
  const floor = orders.filter((o) => ON_FLOOR.includes(o.status));
  const columns = [...MECHANICS.map((m) => ({ id: m.id as string | null, name: m.name, bays: m.bays })), { id: null, name: 'Sem mecânico', bays: 0 }];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {columns.map((c) => {
        const items = floor.filter((o) => o.mechanicId === c.id).sort((a, b) => Number(b.status === 'IN_PROGRESS') - Number(a.status === 'IN_PROGRESS'));
        if (c.id === null && items.length === 0) return null;
        const working = items.filter((o) => o.status === 'IN_PROGRESS').length;
        const full = c.bays > 0 && working >= c.bays;
        return (
          <section key={c.id ?? 'none'} aria-label={`${c.name}, ${items.length} carros`} className="surface flex flex-col overflow-hidden rounded-2xl border bg-card">
            <header className="flex items-center gap-3 bg-brand-secondary px-4 py-3 text-white">
              {c.id ? <Initials name={c.name} className="size-8 bg-brand text-xs" /> : <span className="grid size-8 place-items-center rounded-full border border-dashed border-white/40 text-xs">?</span>}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold">{c.name}</h2>
                {c.bays > 0 && (
                  <p className={cn('tabular text-xs', full ? 'text-red-300' : 'text-white/60')}>
                    {working}/{c.bays} elevadores {full && '· lotado'}
                  </p>
                )}
              </div>
            </header>
            <ul className="flex flex-1 flex-col gap-2 p-2">
              {items.length === 0 && <li className="grid flex-1 place-items-center rounded-xl border border-dashed border-slate-300 py-8 text-xs text-muted-foreground">Livre</li>}
              {items.map((o) => {
                const s = situation(o);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(o.id)}
                      className={cn(
                        'w-full space-y-2 rounded-xl border bg-card p-3 text-left transition hover:border-brand/40 hover:shadow-md',
                        s.late && 'border-red-300 bg-red-50/50',
                        recentlyMovedId === o.id && 'animate-rise border-brand',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <PlateMark value={o.vehicle.plate} />
                        <StatusLabel status={o.status} className="text-slate-600" />
                      </div>
                      <p className="truncate text-sm font-semibold">{o.vehicle.model}</p>
                      <p className={cn('line-clamp-2 text-xs', s.late ? 'font-semibold text-red-700' : 'text-muted-foreground')}>{s.text}</p>
                      {o.status === 'IN_PROGRESS' && <ChecklistBar done={o.checklist.done} total={o.checklist.total} />}
                      {!s.late && <DueChip order={o} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
