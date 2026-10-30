'use client';

import { BadgeCheck, CarFront, Clock, Flame, MessageCircle, PackageCheck, Wrench } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BAYS_TOTAL, brl0, health, orderTotal, type Attention, type MockOrder, type ViewId } from './mock-data';

type Kpi = { id: string; label: string; value: string; hint: string; icon: typeof Wrench; tone: 'neutral' | 'bad' | 'good' | 'warn'; view: ViewId };

function kpis(orders: MockOrder[]): Kpi[] {
  const inShop = orders.filter((o) => o.status === 'IN_PROGRESS' || o.status === 'AWAITING_PART');
  const quotes = orders.filter((o) => o.status === 'QUOTE');
  const trouble = orders.filter((o) => health(o) === 'late' || health(o) === 'risk');
  const ready = orders.filter((o) => o.status === 'COMPLETED');
  const sum = (l: MockOrder[]) => l.reduce((n, o) => n + orderTotal(o), 0);
  return [
    { id: 'shop', label: 'Na oficina', value: String(inShop.length), hint: `${inShop.filter((o) => o.status === 'IN_PROGRESS').length}/${BAYS_TOTAL} elevadores em uso`, icon: Wrench, tone: 'neutral', view: 'all' },
    { id: 'risk', label: 'Atrasadas ou em risco', value: String(trouble.length), hint: trouble.length ? 'Prazo vence em menos de 4 h' : 'Tudo dentro do prazo', icon: Flame, tone: trouble.length ? 'bad' : 'good', view: 'attention' },
    { id: 'quotes', label: 'Orçamentos abertos', value: brl0(sum(quotes)), hint: `${quotes.length} aguardando o cliente`, icon: Clock, tone: 'warn', view: 'waiting' },
    { id: 'ready', label: 'Prontas p/ retirada', value: String(ready.length), hint: `${brl0(sum(ready))} a receber`, icon: PackageCheck, tone: 'good', view: 'pickup' },
  ];
}


/** Números que respondem "como está meu dia". Cada um é um atalho para a visão correspondente. */
export function KpiStrip({ orders, view, onView }: { orders: MockOrder[]; view: ViewId; onView: (v: ViewId) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
      {kpis(orders).map((k) => {
        const active = view === k.view && k.view !== 'all';
        return (
          <li key={k.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onView(active ? 'all' : k.view)}
              className={cn(
                'flex h-full w-full flex-col gap-1 bg-card p-4 text-left transition-colors hover:bg-slate-50',
                active && 'bg-slate-50 shadow-[inset_0_-2px_0_var(--foreground)]',
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <k.icon aria-hidden className="size-3.5" />
                <span className="truncate">{k.label}</span>
              </span>
              <span className={cn('tabular text-2xl leading-tight font-semibold tracking-tight', k.tone === 'bad' && 'text-red-700')}>{k.value}</span>
              <span className="truncate text-xs text-muted-foreground">{k.hint}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const KIND_ICON = { approved: BadgeCheck, part: PackageCheck, late: Flame, quote: Clock, pickup: CarFront } as const;
const KIND_TONE = { approved: 'text-slate-600', part: 'text-slate-600', late: 'text-red-700', quote: 'text-slate-600', pickup: 'text-slate-600' } as const;

/** Fila de decisões do dia: cada item já traz o botão que resolve, sem abrir a ordem. */
export function AttentionInbox({ items, onAct, onOpen }: { items: Attention[]; onAct: (a: Attention) => void; onOpen: (orderId: string) => void }) {
  const reduce = useReducedMotion();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="inbox-title" className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 id="inbox-title" className="text-sm font-semibold">
          Precisa de você
        </h2>
        <span className="tabular text-xs text-muted-foreground">{items.length}</span>
        <span className="text-xs text-muted-foreground">resolva daqui, sem abrir a ordem</span>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none]">
        <AnimatePresence initial={false}>
          {items.map((a) => {
            const Icon = KIND_ICON[a.kind];
            return (
              <motion.li
                key={a.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0, scale: 0.92, width: 0, marginRight: -12 }}
                transition={{ duration: 0.22 }}
                className="w-72 shrink-0 snap-start rounded-xl border bg-card p-3.5"
              >
                <div className="flex items-start gap-3">
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100', KIND_TONE[a.kind])}>
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <button type="button" onClick={() => onOpen(a.orderId)} className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
                    <span className="block truncate text-sm font-semibold hover:underline">{a.title}</span>
                    <span className="block text-xs text-muted-foreground">{a.detail}</span>
                  </button>
                </div>
                <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => onAct(a)}>
                  {a.action.do === 'notify' && <MessageCircle aria-hidden />}
                  {a.action.label}
                </Button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
