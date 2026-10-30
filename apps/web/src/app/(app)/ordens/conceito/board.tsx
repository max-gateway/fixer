'use client';

import { ArrowRight, GripVertical, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Plate } from '@/components/orders/status-badge';
import { STATUS_LABEL, STATUS_STYLE, type OrderStatus } from '@/lib/orders';
import { cn } from '@/lib/utils';
import {
  BAYS_TOTAL,
  BOARD_COLUMNS,
  brl0,
  isActive,
  NOW,
  orderTotal,
  PRIMARY_NEXT,
  TRANSITIONS,
  type MockOrder,
} from './mock-data';
import { ChecklistBar, DueChip, MechanicAvatar, PriorityMark, Signals } from './order-bits';

type Props = {
  orders: MockOrder[];
  compact: boolean;
  recentlyMovedId: string | null;
  onOpen: (id: string) => void;
  onMove: (id: string, to: OrderStatus) => void;
};

/**
 * Quadro por etapa. Arrastar libera só as colunas para onde a ordem pode ir (as outras escurecem), e quem não arrasta
 * (toque, teclado) usa o botão de um clique do cartão. Mesma regra de transição nos dois caminhos.
 */
export function Board({ orders, compact, recentlyMovedId, onOpen, onMove }: Props) {
  const [dragging, setDragging] = useState<MockOrder | null>(null);
  const [over, setOver] = useState<OrderStatus | null>(null);

  const allowed = (to: OrderStatus) => !!dragging && TRANSITIONS[dragging.status].includes(to);

  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 xl:snap-none"
      role="list"
      aria-label="Quadro de ordens por etapa"
    >
      {BOARD_COLUMNS.map((status) => {
        const items = orders.filter((o) => o.status === status);
        const sum = items.reduce((n, o) => n + orderTotal(o), 0);
        const canDrop = allowed(status);
        const blocked = !!dragging && dragging.status !== status && !canDrop;
        const bays = status === 'IN_PROGRESS' ? items.length : null;

        return (
          <section
            key={status}
            role="listitem"
            aria-label={`${STATUS_LABEL[status]}, ${items.length} ordens`}
            onDragOver={(e) => {
              if (!canDrop) return;
              e.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver((c) => (c === status ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && canDrop) onMove(dragging.id, status);
              setDragging(null);
              setOver(null);
            }}
            className={cn(
              'flex w-[17.5rem] shrink-0 snap-start flex-col rounded-2xl border bg-slate-100/70 transition-all duration-150 sm:w-[18.5rem] xl:min-w-0 xl:flex-1',
              canDrop && 'border-dashed border-brand/60 bg-brand-soft/60',
              over === status && 'scale-[1.01] border-brand bg-brand-soft shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand-primary)_18%,transparent)]',
              blocked && 'opacity-45 saturate-50',
            )}
          >
            <header className="flex items-center gap-2 px-3 pt-3 pb-2">
              <span aria-hidden className={cn('size-2 rounded-full', STATUS_STYLE[status].dot)} />
              <h3 className="text-[13px] font-semibold">{STATUS_LABEL[status]}</h3>
              <span className="tabular rounded-full bg-card px-1.5 text-xs font-semibold text-muted-foreground shadow-xs">{items.length}</span>
              <span className="tabular ml-auto text-xs text-muted-foreground">{sum > 0 ? brl0(sum) : ''}</span>
            </header>

            {bays !== null && (
              <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-card/80 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                <Wrench aria-hidden className="size-3" />
                <span className="tabular">
                  {bays}/{BAYS_TOTAL} elevadores
                </span>
                <div className="ml-auto flex gap-0.5" aria-hidden>
                  {Array.from({ length: BAYS_TOTAL }, (_, i) => (
                    <span key={i} className={cn('h-2.5 w-1.5 rounded-sm', i < bays ? 'bg-brand' : 'bg-slate-300')} />
                  ))}
                </div>
              </div>
            )}

            <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {items.map((o) => (
                <li key={o.id}>
                  <OrderCard
                    order={o}
                    compact={compact}
                    dragging={dragging?.id === o.id}
                    justMoved={recentlyMovedId === o.id}
                    onOpen={() => onOpen(o.id)}
                    onAdvance={() => PRIMARY_NEXT[o.status] && onMove(o.id, PRIMARY_NEXT[o.status]!.to)}
                    onDragStart={() => setDragging(o)}
                    onDragEnd={() => (setDragging(null), setOver(null))}
                  />
                </li>
              ))}
              {items.length === 0 && (
                <li className="grid flex-1 place-items-center rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-muted-foreground">
                  {canDrop ? 'Solte aqui' : 'Nada por aqui'}
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function OrderCard({
  order: o,
  compact,
  dragging,
  justMoved,
  onOpen,
  onAdvance,
  onDragStart,
  onDragEnd,
}: {
  order: MockOrder;
  compact: boolean;
  dragging: boolean;
  justMoved: boolean;
  onOpen: () => void;
  onAdvance: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const next = PRIMARY_NEXT[o.status];
  const firstService = o.services[0]?.name ?? 'Sem serviço';
  const extra = o.services.length - 1;

  return (
    <article
      data-order-id={o.id}
      tabIndex={0}
      draggable={TRANSITIONS[o.status].length > 0}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', o.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Ordem ${o.number}, ${o.vehicle.brand} ${o.vehicle.model}, ${o.customer.name}`}
      className={cn(
        'group surface relative cursor-pointer rounded-xl border bg-card p-3 text-left transition-[transform,box-shadow,opacity] duration-150 outline-none',
        'hover:-translate-y-px hover:border-brand/40 focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/30',
        dragging && 'rotate-1 opacity-40',
        justMoved && 'animate-rise ring-2 ring-brand/50',
        !isActive(o) && 'opacity-80',
      )}
    >
      <GripVertical aria-hidden className="absolute top-3 left-0.5 size-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden" />

      <div className="flex items-center gap-1.5">
        <span className="tabular text-xs font-semibold text-brand">#{o.number}</span>
        <PriorityMark priority={o.priority} />
        <DueChip order={o} className="ml-auto" />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Plate value={o.vehicle.plate} />
        <span className="truncate text-sm font-medium">
          {o.vehicle.brand} {o.vehicle.model}
        </span>
      </div>
      <p className="mt-1 truncate text-[13px] text-muted-foreground">{o.customer.name}</p>

      {!compact && (
        <p className="mt-2 truncate text-xs text-slate-600">
          {firstService}
          {extra > 0 && <span className="ml-1 rounded bg-slate-100 px-1 font-medium text-slate-500">+{extra}</span>}
        </p>
      )}

      {o.status === 'IN_PROGRESS' && <ChecklistBar done={o.checklist.done} total={o.checklist.total} className="mt-2" />}
      {o.status === 'AWAITING_PART' && o.partEta && (
        <p className="mt-2 text-[11px] text-amber-800">
          {Date.parse(o.partEta) <= NOW ? 'Peça chegou, retomar' : 'Peça prevista para amanhã'}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 border-t pt-2.5">
        <MechanicAvatar id={o.mechanicId} />
        <Signals order={o} />
        <span className="tabular ml-auto text-sm font-semibold">{brl0(orderTotal(o))}</span>
      </div>

      {next && (
        <button
          type="button"
          onClick={(e) => (e.stopPropagation(), onAdvance())}
          className="absolute -bottom-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-brand/30 bg-card px-3 py-1 text-xs font-semibold text-brand shadow-sm transition-all hover:bg-brand hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none sm:translate-y-1 sm:opacity-0 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100 sm:group-hover:translate-y-0 sm:group-hover:opacity-100"
        >
          {next.label} <ArrowRight aria-hidden className="size-3" />
        </button>
      )}
    </article>
  );
}
