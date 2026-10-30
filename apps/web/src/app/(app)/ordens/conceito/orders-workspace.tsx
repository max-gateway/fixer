'use client';

import { FileSearch, Keyboard, LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToastProvider, useToast } from '@/components/ui/toaster';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import { cn } from '@/lib/utils';
import { Board } from './board';
import { BulkBar } from './bulk-bar';
import { AttentionInbox, KpiStrip } from './insights';
import {
  attentionItems,
  INITIAL_ORDERS,
  inView,
  MECHANICS,
  NOW,
  orderTotal,
  brl0,
  TRANSITIONS,
  VIEWS,
  type Attention,
  type MockOrder,
  type ViewId,
} from './mock-data';
import { Initials } from './order-bits';
import { OrderPeek } from './order-peek';
import { OrdersTable } from './orders-table';

export function OrdersConcept() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}

const SHORTCUTS: [string[], string][] = [
  [['/'], 'Buscar'],
  [['B'], 'Ver como quadro'],
  [['L'], 'Ver como lista'],
  [['J', 'K'], 'Próxima / anterior ordem'],
  [['Enter'], 'Abrir a ordem em foco'],
  [[']'], 'Avançar a etapa da ordem em foco'],
  [['Esc'], 'Fechar painel'],
];

function Workspace() {
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [layout, setLayout] = useState<'board' | 'list'>('board');
  const [view, setView] = useState<ViewId>('all');
  const [mechanic, setMechanic] = useState<string | 'none' | null>(null);
  const [q, setQ] = useState('');
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [peekId, setPeekId] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());

  const byId = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase().replace('#', '');
    return orders.filter((o) => {
      if (!inView(o, view)) return false;
      if (mechanic === 'none' ? o.mechanicId !== null : mechanic && o.mechanicId !== mechanic) return false;
      if (!term) return true;
      return [String(o.number), o.vehicle.plate, o.vehicle.model, o.vehicle.brand, o.customer.name].some((f) => f.toLowerCase().includes(term));
    });
  }, [orders, view, mechanic, q]);

  const attention = useMemo(() => attentionItems(orders).filter((a) => !handled.has(a.id)), [orders, handled]);
  const viewCount = (v: ViewId) => orders.filter((o) => inView(o, v) && (v !== 'all' || (o.status !== 'DELIVERED' && o.status !== 'CANCELLED'))).length;
  const filtered = view !== 'all' || mechanic !== null || q.trim() !== '';

  const applyMoves = useCallback(
    (moves: { id: string; to: OrderStatus }[]) => {
      const valid = moves.filter((m) => {
        const o = byId.get(m.id);
        return o && TRANSITIONS[o.status].includes(m.to);
      });
      if (valid.length === 0) {
        toast({ title: 'Movimento não permitido', description: 'Essa ordem não pode ir direto para essa etapa.', tone: 'error' });
        return;
      }
      const before = new Map(valid.map((m) => [m.id, byId.get(m.id)!]));
      const at = new Date(NOW).toISOString();
      setOrders((list) =>
        list.map((o) => {
          const m = valid.find((v) => v.id === o.id);
          return m ? { ...o, status: m.to, updatedAt: at, timeline: [...o.timeline, { at, text: `Movida para ${STATUS_LABEL[m.to]}`, by: 'Você' }] } : o;
        }),
      );
      setMoved(valid[0]!.id);
      setTimeout(() => setMoved(null), 1400);
      const one = valid.length === 1 ? before.get(valid[0]!.id)! : null;
      toast({
        title: one ? `#${one.number} → ${STATUS_LABEL[valid[0]!.to]}` : `${valid.length} ordens → ${STATUS_LABEL[valid[0]!.to]}`,
        action: { label: 'Desfazer', onClick: () => setOrders((list) => list.map((o) => before.get(o.id) ?? o)) },
      });
    },
    [byId, toast],
  );

  const move = useCallback((id: string, to: OrderStatus) => applyMoves([{ id, to }]), [applyMoves]);

  const assign = useCallback(
    (ids: string[], mechanicId: string | null) => {
      setOrders((list) => list.map((o) => (ids.includes(o.id) ? { ...o, mechanicId } : o)));
      const m = MECHANICS.find((x) => x.id === mechanicId);
      toast({ title: m ? `${ids.length === 1 ? 'Ordem atribuída' : `${ids.length} ordens atribuídas`} a ${m.name}` : 'Atribuição removida' });
    },
    [toast],
  );

  const notify = useCallback(
    (ids: string[]) => {
      const first = byId.get(ids[0]!);
      toast({ title: ids.length === 1 ? `Aviso enviado a ${first?.customer.name}` : `Aviso enviado a ${ids.length} clientes`, description: 'Pelo WhatsApp, com o link do portal.', tone: 'info' });
    },
    [byId, toast],
  );

  function act(a: Attention) {
    if (a.action.do === 'approve') move(a.orderId, 'APPROVED');
    else if (a.action.do === 'resume') move(a.orderId, 'IN_PROGRESS');
    else if (a.action.do === 'deliver') move(a.orderId, 'DELIVERED');
    else {
      notify([a.orderId]);
      setHandled((s) => new Set(s).add(a.id));
    }
  }

  function clearFilters() {
    setView('all');
    setMechanic(null);
    setQ('');
  }

  // Atalhos: só valem fora de campos de texto e com nenhum painel aberto (o Radix já prende o foco neles).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable], [role=dialog]')) return;
      const key = e.key.toLowerCase();
      if (key === '/') (e.preventDefault(), searchRef.current?.focus());
      else if (key === 'b') setLayout('board');
      else if (key === 'l') setLayout('list');
      else if (key === 'j' || key === 'k') {
        const nodes = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-order-id]') ?? [])];
        if (nodes.length === 0) return;
        const at = nodes.indexOf(document.activeElement?.closest<HTMLElement>('[data-order-id]') as HTMLElement);
        const next = nodes[at < 0 ? 0 : Math.min(nodes.length - 1, Math.max(0, at + (key === 'j' ? 1 : -1)))]!;
        e.preventDefault();
        next.focus();
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (key === ']') {
        const id = document.activeElement?.closest<HTMLElement>('[data-order-id]')?.dataset.orderId;
        const o = id ? byId.get(id) : undefined;
        const to = o && TRANSITIONS[o.status][0];
        if (o && to && to !== 'CANCELLED') move(o.id, o.status === 'COMPLETED' ? 'DELIVERED' : to);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [byId, move]);

  const selectedOrders = useMemo(() => [...selected].map((id) => byId.get(id)).filter((o): o is MockOrder => !!o), [selected, byId]);
  const total = visible.reduce((n, o) => n + orderTotal(o), 0);

  return (
    <div ref={rootRef} className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Ordens de serviço</h1>
            <Badge variant="outline" className="text-muted-foreground">Conceito · dados fictícios</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Quinta, 30 de outubro · o que precisa de você, o que está na oficina e o que está pronto.</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={layout}
            onValueChange={(v) => v && (setLayout(v as 'board' | 'list'), setSelected(new Set()))}
            aria-label="Modo de visualização"
          >
            <ToggleGroupItem value="board" aria-label="Quadro">
              <LayoutGrid aria-hidden /> <span className="max-sm:hidden">Quadro</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="Lista">
              <List aria-hidden /> <span className="max-sm:hidden">Lista</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <Link href="/ordens/nova" className={buttonVariants({ size: 'lg' })}>
            <Plus aria-hidden /> Nova ordem
          </Link>
        </div>
      </header>

      <KpiStrip orders={orders} view={view} onView={setView} />
      <AttentionInbox items={attention} onAct={act} onOpen={setPeekId} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1 sm:max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Número, placa, modelo ou cliente"
              aria-label="Buscar ordens"
              className="h-10 pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
            />
            <div className="absolute top-1/2 right-2.5 -translate-y-1/2">
              {q ? (
                <button type="button" aria-label="Limpar busca" onClick={() => setQ('')} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted">
                  <X className="size-4" />
                </button>
              ) : (
                <Kbd className="max-sm:hidden">/</Kbd>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="Filtrar por mecânico">
            {MECHANICS.map((m) => {
              const active = mechanic === m.id;
              const load = orders.filter((o) => o.mechanicId === m.id && o.status === 'IN_PROGRESS').length;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={active}
                  title={`${m.name} · ${load}/${m.bays} em andamento`}
                  onClick={() => setMechanic(active ? null : m.id)}
                  className={cn('group relative rounded-full p-0.5 transition-all', active ? 'ring-2 ring-slate-900 ring-offset-2' : 'opacity-70 hover:opacity-100', mechanic && !active && 'opacity-40')}
                >
                  <Initials name={m.name} className="size-8 text-xs" />
                  <span aria-hidden className="absolute inset-x-1 -bottom-1 h-1 overflow-hidden rounded-full bg-slate-300">
                    <span className={cn('block h-full', load >= m.bays ? 'bg-red-600' : 'bg-slate-600')} style={{ width: `${Math.min(100, (load / m.bays) * 100)}%` }} />
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={mechanic === 'none'}
              onClick={() => setMechanic(mechanic === 'none' ? null : 'none')}
              className={cn('ml-1 h-8 rounded-full border border-dashed px-2.5 text-xs font-medium text-slate-600 hover:border-slate-400', mechanic === 'none' && 'border-slate-900 bg-slate-900 text-white')}
            >
              Sem mecânico
            </button>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {layout === 'board' && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground max-sm:hidden">
                <Switch checked={compact} onCheckedChange={setCompact} aria-label="Cartões compactos" /> Compacto
              </label>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Atalhos de teclado">
                  <Keyboard aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-2 p-3">
                <p className="text-sm font-semibold">Atalhos</p>
                <ul className="space-y-1.5 text-sm">
                  {SHORTCUTS.map(([keys, label]) => (
                    <li key={label} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="flex gap-1">
                        {keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewId)} className="max-w-full">
            <TabsList className="h-10 max-w-full justify-start overflow-x-auto [scrollbar-width:none]">
              {VIEWS.map((v) => (
                <TabsTrigger key={v.id} value={v.id} title={v.hint} className="flex-none px-3">
                  {v.label}
                  <span className={cn('tabular rounded-full px-1.5 text-[11px]', view === v.id ? 'bg-slate-900 text-white' : 'bg-slate-200/70 text-slate-500')}>{viewCount(v.id)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="tabular text-xs text-muted-foreground" aria-live="polite">
            {visible.length} {visible.length === 1 ? 'ordem' : 'ordens'} · {brl0(total)}
            {filtered && (
              <button type="button" onClick={clearFilters} className="ml-2 font-semibold text-foreground underline">
                Limpar filtros
              </button>
            )}
          </p>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <FileSearch aria-hidden className="size-6" />
          </span>
          <div>
            <p className="font-semibold">Nenhuma ordem com esses filtros</p>
            <p className="text-sm text-muted-foreground">Tente outro termo ou volte para todas as ordens.</p>
          </div>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Limpar filtros
          </Button>
        </div>
      ) : layout === 'board' ? (
        <Board orders={visible} compact={compact} recentlyMovedId={moved} onOpen={setPeekId} onMove={move} />
      ) : (
        <OrdersTable orders={visible} selected={selected} onSelectedChange={setSelected} onOpen={setPeekId} />
      )}

      <BulkBar
        selected={selectedOrders}
        onClear={() => setSelected(new Set())}
        onMove={(to) => (applyMoves(selectedOrders.map((o) => ({ id: o.id, to }))), setSelected(new Set()))}
        onAssign={(m) => assign([...selected], m)}
        onNotify={() => notify([...selected])}
      />

      <OrderPeek
        order={peekId ? (byId.get(peekId) ?? null) : null}
        onClose={() => setPeekId(null)}
        onMove={move}
        onAssign={(id, m) => assign([id], m)}
        onNotify={(id) => notify([id])}
      />
    </div>
  );
}
