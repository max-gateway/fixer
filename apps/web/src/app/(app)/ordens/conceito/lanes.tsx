'use client';

import { ChevronDown, MessageCircle } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { BAYS_TOTAL, brl0, LANES, orderTotal, situation, type Lane, type MockOrder, type Next, type Situation } from './mock-data';
import { ChecklistBar, DueChip, MechanicName, PlateMark, PriorityMark, Slash } from './order-bits';

type Props = {
  orders: MockOrder[];
  /** Com busca ou filtro, os entregues abrem sozinhos: o carro procurado pode estar lá. */
  searching: boolean;
  recentlyMovedId: string | null;
  onOpen: (id: string) => void;
  onAct: (order: MockOrder, next: Next) => void;
};

/**
 * Uma lista só, agrupada por quem está com a bola. Cada ordem aparece em um lugar, com uma frase dizendo por que está
 * ali e no máximo um botão. Ao agir, a linha desliza para o grupo seguinte e o movimento explica o que aconteceu.
 */
export function LaneList({ orders, searching, recentlyMovedId, onOpen, onAct }: Props) {
  const rows = orders.map((o) => ({ o, s: situation(o) }));
  const of = (lane: Lane) => rows.filter((r) => r.s.lane === lane).sort((a, b) => a.s.weight - b.s.weight || Number(b.s.late) - Number(a.s.late));

  return (
    <LayoutGroup>
      <div className="space-y-8">
        {LANES.filter((l) => l.id !== 'done').map((lane) => {
          const items = of(lane.id);
          if (items.length === 0 && lane.id !== 'yours') return null;
          const extra = lane.id === 'shop' ? `${orders.filter((o) => o.status === 'IN_PROGRESS').length}/${BAYS_TOTAL} elevadores em uso` : null;
          return (
            <section key={lane.id} aria-labelledby={`lane-${lane.id}`} className="space-y-3">
              <LaneHeader id={lane.id} label={lane.label} hint={lane.hint} count={items.length} extra={extra} />
              {items.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-300 px-5 py-6 text-center text-sm text-muted-foreground">Nada esperando por você agora.</p>
              ) : (
                <Rows lane={lane.id} items={items} recentlyMovedId={recentlyMovedId} onOpen={onOpen} onAct={onAct} />
              )}
            </section>
          );
        })}
        <DoneLane items={of('done')} defaultOpen={searching} recentlyMovedId={recentlyMovedId} onOpen={onOpen} onAct={onAct} />
      </div>
    </LayoutGroup>
  );
}

function LaneHeader({ id, label, hint, count, extra }: { id: Lane; label: string; hint: string; count: number; extra?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Slash className={id === 'yours' ? undefined : 'bg-slate-300'} />
      <h2 id={`lane-${id}`} className={cn('text-base font-bold tracking-wide uppercase', id === 'yours' ? 'text-slate-900' : 'text-slate-700')}>
        {label}
      </h2>
      <span className={cn('tabular font-display rounded-md px-1.5 text-sm font-semibold', id === 'yours' && count > 0 ? 'bg-brand text-white' : 'bg-slate-200 text-slate-600')}>{count}</span>
      <span className="text-sm text-muted-foreground">{hint}</span>
      {extra && <span className="tabular ml-auto text-xs text-muted-foreground">{extra}</span>}
    </div>
  );
}

type RowsProps = { lane: Lane; items: { o: MockOrder; s: Situation }[]; recentlyMovedId: string | null; onOpen: (id: string) => void; onAct: (o: MockOrder, n: Next) => void };

function Rows({ lane, items, recentlyMovedId, onOpen, onAct }: RowsProps) {
  const reduce = useReducedMotion();
  return (
    <ul className={cn('surface divide-y overflow-hidden rounded-2xl border bg-card', lane === 'yours' && 'border-brand/30')}>
      <AnimatePresence initial={false} mode="popLayout">
        {items.map(({ o, s }) => (
          <motion.li
            key={o.id}
            layoutId={reduce ? undefined : o.id}
            layout={reduce ? false : 'position'}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="bg-card"
          >
            <OrderRow order={o} s={s} emphasis={lane === 'yours'} justMoved={recentlyMovedId === o.id} onOpen={() => onOpen(o.id)} onAct={(n) => onAct(o, n)} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function OrderRow({ order: o, s, emphasis, justMoved, onOpen, onAct }: { order: MockOrder; s: Situation; emphasis: boolean; justMoved: boolean; onOpen: () => void; onAct: (n: Next) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${o.vehicle.brand} ${o.vehicle.model}, placa ${o.vehicle.plate}, ${o.customer.name}: ${s.text}`}
      className={cn(
        'relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors outline-none hover:bg-slate-50 focus-visible:bg-brand-soft sm:px-5',
        'md:grid-cols-[auto_minmax(9rem,13rem)_minmax(0,1fr)_7rem_6rem_9rem]',
        justMoved && 'animate-rise bg-brand-soft',
      )}
    >
      {(s.late || emphasis) && <span aria-hidden className={cn('absolute inset-y-3 left-0 w-1 rounded-r', s.late ? 'bg-red-600' : 'bg-brand')} />}

      <PlateMark value={o.vehicle.plate} />

      <div className="min-w-0">
        <p className="flex items-center gap-1 truncate text-sm font-semibold text-slate-900">
          <span className="truncate">
            {o.vehicle.brand} {o.vehicle.model}
          </span>
          <PriorityMark priority={o.priority} />
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {o.customer.name} · <span className="tabular">#{o.number}</span>
        </p>
      </div>

      <div className="min-w-0 max-md:col-span-2 max-md:row-start-2">
        <p className={cn('text-sm', s.late ? 'font-semibold text-red-700' : emphasis ? 'font-medium text-slate-900' : 'text-slate-600')}>{s.text}</p>
        {(o.status === 'IN_PROGRESS' || (o.status === 'APPROVED' && !s.late)) && (
          <div className="mt-1 flex items-center gap-3">
            {o.status === 'IN_PROGRESS' && <ChecklistBar done={o.checklist.done} total={o.checklist.total} className="w-32" />}
            {!s.late && <DueChip order={o} />}
          </div>
        )}
      </div>

      <MechanicName id={o.mechanicId} className="max-md:hidden" />

      <span className="tabular font-display text-right text-sm font-semibold text-slate-900 max-md:col-start-3 max-md:row-start-1">{brl0(orderTotal(o))}</span>

      <div className="justify-self-end max-md:col-start-3 max-md:row-start-2">
        {s.next && (
          <Button
            size="sm"
            variant={emphasis ? 'default' : 'outline'}
            onClick={(e) => {
              e.stopPropagation();
              onAct(s.next!);
            }}
          >
            {'notify' in s.next && <MessageCircle aria-hidden />}
            {s.next.label}
          </Button>
        )}
      </div>
    </div>
  );
}

function DoneLane({ items, defaultOpen, ...rest }: { items: { o: MockOrder; s: Situation }[]; defaultOpen: boolean } & Omit<RowsProps, 'lane' | 'items'>) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const isOpen = open || defaultOpen;
  return (
    <Collapsible open={isOpen} onOpenChange={setOpen} asChild>
      <section aria-labelledby="lane-done" className="space-y-3">
        <CollapsibleTrigger className="group flex items-center gap-3 rounded-md text-left">
          <Slash className="bg-slate-300" />
          <h2 id="lane-done" className="text-base font-bold tracking-wide text-slate-500 uppercase">
            Entregues
          </h2>
          <span className="tabular font-display rounded-md bg-slate-200 px-1.5 text-sm font-semibold text-slate-600">{items.length}</span>
          <ChevronDown aria-hidden className={cn('size-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Rows lane="done" items={items} {...rest} />
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
