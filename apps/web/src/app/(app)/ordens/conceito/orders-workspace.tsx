'use client';

import { FileSearch, LayoutList, Plus, Search, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ToastProvider, useToast } from '@/components/ui/toaster';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import { cn } from '@/lib/utils';
import { LaneList } from './lanes';
import { MechanicBoard } from './mechanic-board';
import { brl0, health, INITIAL_ORDERS, MECHANICS, NOW, orderTotal, situation, TRANSITIONS, type MockOrder, type Next } from './mock-data';
import { Slash } from './order-bits';
import { OrderPeek } from './order-peek';

export function OrdersConcept() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}

type Layout = 'lanes' | 'mechanics';

function Workspace() {
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [layout, setLayout] = useState<Layout>('lanes');
  const [mechanic, setMechanic] = useState<string>('all');
  const [q, setQ] = useState('');
  const [peekId, setPeekId] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  const byId = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase().replace('#', '');
    return orders.filter((o) => {
      if (mechanic === 'none' ? o.mechanicId !== null : mechanic !== 'all' && o.mechanicId !== mechanic) return false;
      if (!term) return true;
      return [String(o.number), o.vehicle.plate, o.vehicle.model, o.vehicle.brand, o.customer.name].some((f) => f.toLowerCase().includes(term));
    });
  }, [orders, mechanic, q]);

  const flash = (id: string) => {
    setMoved(id);
    setTimeout(() => setMoved(null), 1400);
  };

  const move = useCallback(
    (id: string, to: OrderStatus) => {
      const before = byId.get(id);
      if (!before || !TRANSITIONS[before.status].includes(to)) {
        toast({ title: 'Movimento não permitido', description: 'Essa ordem não pode ir direto para essa etapa.', tone: 'error' });
        return;
      }
      const at = new Date(NOW).toISOString();
      setOrders((list) => list.map((o) => (o.id === id ? { ...o, status: to, customerApproved: false, updatedAt: at, timeline: [...o.timeline, { at, text: `Movida para ${STATUS_LABEL[to]}`, by: 'Você' }] } : o)));
      flash(id);
      toast({
        title: `${before.vehicle.model} → ${STATUS_LABEL[to]}`,
        action: { label: 'Desfazer', onClick: () => setOrders((list) => list.map((o) => (o.id === id ? before : o))) },
      });
    },
    [byId, toast],
  );

  const assign = useCallback(
    (id: string, mechanicId: string | null) => {
      setOrders((list) => list.map((o) => (o.id === id ? { ...o, mechanicId } : o)));
      const m = MECHANICS.find((x) => x.id === mechanicId);
      flash(id);
      toast({ title: m ? `Ordem atribuída a ${m.name}` : 'Atribuição removida' });
    },
    [toast],
  );

  const notify = useCallback(
    (id: string) => {
      const at = new Date(NOW).toISOString();
      setOrders((list) => list.map((o) => (o.id === id ? { ...o, notifiedAt: at, timeline: [...o.timeline, { at, text: 'Cliente avisado pelo WhatsApp', by: 'Você' }] } : o)));
      flash(id);
      toast({ title: `Aviso enviado a ${byId.get(id)?.customer.name}`, description: 'Pelo WhatsApp, com o link do portal.', tone: 'info' });
    },
    [byId, toast],
  );

  function act(o: MockOrder, next: Next) {
    if ('to' in next) move(o.id, next.to);
    else if ('notify' in next) notify(o.id);
    else setPeekId(o.id);
  }

  function clearFilters() {
    setMechanic('all');
    setQ('');
  }

  // "/" foca a busca: no balcão, o caso mais comum é o cliente ligando para saber do carro.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || t.closest('input, textarea, select, [contenteditable], [role=dialog]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = mechanic !== 'all' || q.trim() !== '';

  return (
    <div className="space-y-6">
      <Hero orders={orders} q={q} onQ={setQ} searchRef={searchRef} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" value={layout} onValueChange={(v) => v && setLayout(v as Layout)} aria-label="Como agrupar">
          <ToggleGroupItem value="lanes">
            <LayoutList aria-hidden /> Por situação
          </ToggleGroupItem>
          <ToggleGroupItem value="mechanics">
            <Users aria-hidden /> Por mecânico
          </ToggleGroupItem>
        </ToggleGroup>

        {layout === 'lanes' && (
          <ToggleGroup type="single" size="sm" value={mechanic} onValueChange={(v) => setMechanic(v || 'all')} aria-label="Filtrar por mecânico" className="max-w-full overflow-x-auto [scrollbar-width:none]">
            <ToggleGroupItem value="all">Todos</ToggleGroupItem>
            {MECHANICS.map((m) => (
              <ToggleGroupItem key={m.id} value={m.id}>
                {m.name.split(' ')[0]}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="none">Sem mecânico</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="surface grid place-items-center gap-3 rounded-2xl border bg-card px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
            <FileSearch aria-hidden className="size-6" />
          </span>
          <div>
            <p className="font-display font-semibold">Nenhuma ordem encontrada</p>
            <p className="text-sm text-muted-foreground">Confira a placa ou o nome e tente de novo.</p>
          </div>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Limpar busca
          </Button>
        </div>
      ) : layout === 'lanes' ? (
        <LaneList orders={visible} searching={filtered} recentlyMovedId={moved} onOpen={setPeekId} onAct={act} />
      ) : (
        <MechanicBoard orders={q.trim() ? visible : orders} recentlyMovedId={moved} onOpen={setPeekId} />
      )}

      <OrderPeek order={peekId ? (byId.get(peekId) ?? null) : null} onClose={() => setPeekId(null)} onMove={move} onAssign={assign} onNotify={notify} />
    </div>
  );
}

const TODAY = new Date(NOW).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });

/** Cabeçalho na identidade da logo: preto profundo, traço azul, o resumo do dia em números e a busca no centro. */
function Hero({ orders, q, onQ, searchRef }: { orders: MockOrder[]; q: string; onQ: (q: string) => void; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const inShop = orders.filter((o) => ['APPROVED', 'IN_PROGRESS', 'AWAITING_PART'].includes(o.status)).length;
  const yours = orders.filter((o) => situation(o).lane === 'yours').length;
  const late = orders.filter((o) => health(o) === 'late').length;
  const ready = orders.filter((o) => o.status === 'COMPLETED').reduce((n, o) => n + orderTotal(o), 0);

  const stats = [
    { value: String(yours), label: 'esperando você', accent: yours > 0 },
    { value: String(inShop), label: 'carros na oficina' },
    { value: String(late), label: late === 1 ? 'atrasado' : 'atrasados', bad: late > 0 },
    { value: brl0(ready), label: 'pronto p/ receber' },
  ];

  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-brand-secondary text-white shadow-lg">
      <div aria-hidden className="absolute -top-24 right-[-10%] -z-10 h-64 w-[60%] -skew-x-[35deg] bg-brand/15 blur-2xl" />
      <div className="space-y-6 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs font-medium tracking-widest text-white/60 uppercase">
              <Slash /> {TODAY}
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              Ordens de serviço
              <span className="ml-3 align-middle rounded-full border border-white/20 px-2 py-0.5 font-sans text-[11px] font-medium tracking-normal text-white/60">conceito · dados fictícios</span>
            </h1>
          </div>
          <Link href="/ordens/nova" className={buttonVariants({ size: 'lg' })}>
            <Plus aria-hidden /> Nova ordem
          </Link>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="border-l-2 border-white/10 pl-3">
              <dd className={cn('font-display tabular text-2xl leading-none font-bold sm:text-3xl', s.accent && 'text-[#6ea0ff]', s.bad && 'text-red-400')}>{s.value}</dd>
              <dt className="mt-1 text-xs text-white/60">{s.label}</dt>
            </div>
          ))}
        </dl>

        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Placa, cliente, modelo ou nº da ordem"
            aria-label="Buscar ordens"
            className="h-12 w-full rounded-xl border-0 bg-white pr-12 pl-12 text-base text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus-visible:ring-4 focus-visible:ring-brand/50 [&::-webkit-search-cancel-button]:hidden"
          />
          <div className="absolute top-1/2 right-3 -translate-y-1/2">
            {q ? (
              <button type="button" aria-label="Limpar busca" onClick={() => onQ('')} className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100">
                <X className="size-4" />
              </button>
            ) : (
              <Kbd className="max-sm:hidden">/</Kbd>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
