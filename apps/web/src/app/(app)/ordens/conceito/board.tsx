'use client';

import { ArrowRight } from 'lucide-react';
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
 * Quadro por etapa. Arrastar libera só as colunas para onde a ordem pode ir (as outras ficam esmaecidas), e quem não
 * arrasta (toque, teclado) usa o botão do rodapé do cartão. Mesma regra de transição nos dois caminhos.
 */
export function Board({ orders, compact, recentlyMovedId, onOpen, onMove }: Props) {
  const [dragging, setDragging] = useState<MockOrder | null>(null);
  const [over, setOver] = useState<OrderStatus | null>(null);

  const allowed = (to: OrderStatus) => !!dragging && TRANSITIONS[dragging.status].includes(to);

  return (
    <div className="-mx-4 flex snap-x snap-mandatory items-start gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 xl:snap-none" role="list" aria-label="Quadro de ordens por etapa">
      {BOARD_COLUMNS.map((status) => {
        const items = orders.filter((o) => o.status === status);
        const sum = items.reduce((n, o) => n + orderTotal(o), 0);
        const canDrop = allowed(status);
        const blocked = !!dragging && dragging.status !== status && !canDrop;

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
              'flex w-72 shrink-0 snap-start flex-col rounded-xl p-1.5 transition-colors duration-150 xl:w-auto xl:min-w-64 xl:flex-1',
              canDrop && 'bg-slate-100 outline-1 outline-dashed outline-slate-400',
              over === status && 'bg-slate-200/70 outline-slate-900',
              blocked && 'opacity-40',
            )}
          >
            <header className="flex items-center gap-2 px-2 pt-1.5 pb-3">
              <span aria-hidden className={cn('size-2 rounded-full', STATUS_STYLE[status].dot)} />
              <h3 className="text-[13px] font-semibold">{STATUS_LABEL[status]}</h3>
              <span className="tabular text-xs text-muted-foreground">{items.length}</span>
              <span className="tabular ml-auto text-xs text-muted-foreground">
                {status === 'IN_PROGRESS' ? `${items.length}/${BAYS_TOTAL} elevadores` : sum > 0 ? brl0(sum) : ''}
              </span>
            </header>

            <ul className="flex min-h-20 flex-col gap-2.5">
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
                <li className="grid h-20 place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-muted-foreground">
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
  const extra = o.services.length - 1;
  const partArrived = o.status === 'AWAITING_PART' && !!o.partEta && Date.parse(o.partEta) <= NOW;

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
        'cursor-pointer overflow-hidden rounded-lg border bg-card text-left shadow-xs transition-[box-shadow,border-color,opacity] duration-150 outline-none',
        'hover:border-slate-300 hover:shadow-md focus-visible:border-slate-900 focus-visible:ring-[3px] focus-visible:ring-slate-900/10',
        dragging && 'opacity-40',
        justMoved && 'animate-rise border-slate-900',
        !isActive(o) && 'bg-slate-50',
      )}
    >
      <div className="space-y-2.5 p-3">
        <div className="flex items-center gap-1.5">
          <span className="tabular text-xs font-semibold text-slate-500">#{o.number}</span>
          <PriorityMark priority={o.priority} />
          <DueChip order={o} className="ml-auto" />
        </div>

        <div className="space-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Plate value={o.vehicle.plate} className="shrink-0" />
            <span className="truncate text-sm font-semibold">
              {o.vehicle.brand} {o.vehicle.model}
            </span>
          </div>
          <p className="truncate text-[13px] text-muted-foreground">{o.customer.name}</p>
        </div>

        {!compact && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
            <span className="truncate">{o.services[0]?.name ?? 'Sem serviço'}</span>
            {extra > 0 && <span className="shrink-0 text-muted-foreground">+{extra}</span>}
          </p>
        )}

        {o.status === 'IN_PROGRESS' && <ChecklistBar done={o.checklist.done} total={o.checklist.total} />}
        {o.status === 'AWAITING_PART' && (
          <p className="text-xs text-muted-foreground">{partArrived ? 'Peça chegou: pode retomar' : 'Peça prevista para amanhã'}</p>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <MechanicAvatar id={o.mechanicId} />
          <Signals order={o} />
          <span className="tabular ml-auto text-sm font-semibold">{brl0(orderTotal(o))}</span>
        </div>
      </div>

      {next && (
        <button
          type="button"
          onClick={(e) => (e.stopPropagation(), onAdvance())}
          className={cn(
            'flex w-full items-center justify-between border-t bg-slate-50 px-3 py-2 text-xs font-semibold transition-colors hover:bg-slate-900 hover:text-white focus-visible:bg-slate-900 focus-visible:text-white focus-visible:outline-none',
            partArrived ? 'text-slate-900' : 'text-slate-600',
          )}
        >
          {next.label}
          <ArrowRight aria-hidden className="size-3.5" />
        </button>
      )}
    </article>
  );
}
