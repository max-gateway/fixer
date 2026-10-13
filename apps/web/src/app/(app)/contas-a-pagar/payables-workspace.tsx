'use client';

import { Keyboard, Plus, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ToastProvider, useToast } from '@/components/ui/toaster';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  filtersToParams,
  groupRows,
  money,
  sumAmounts,
  VIEWS,
  type Filters,
  type ForecastBucket,
  type PayableDetail,
  type PayableRow,
} from '@/lib/payables';
import { BulkBar } from './bulk-bar';
import { ComposerSheet } from './composer-sheet';
import { DetailSheet } from './detail-sheet';
import { useCategories, useDetail, useForecast, useListing, usePayableActions, useSuppliers, useSummary, type CreateInput, type Initial, type PayInput, type UpdateInput } from './hooks';
import { Overview } from './overview';
import { PayDialog } from './pay-dialog';
import { PayableList } from './payable-list';
import { ShortcutsDialog } from './shortcuts-dialog';
import { Toolbar } from './toolbar';

export type Access = { manage: boolean; pay: boolean };

export function PayablesWorkspace(props: { initial: Initial; access: Access; openId: string | null; compose: boolean }) {
  return (
    <ToastProvider>
      <Workspace {...props} />
    </ToastProvider>
  );
}

type Confirm = { title: string; description: string; label: string; run: () => void } | null;

const PAGE = 100;
const MAX = 500;

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

function Workspace({ initial, access, openId: initialOpen, compose }: { initial: Initial; access: Access; openId: string | null; compose: boolean }) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [limit, setLimit] = useState(initial.limit);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [composerOpen, setComposerOpen] = useState(compose);
  const [payRows, setPayRows] = useState<PayableRow[] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const listing = useListing(filters, limit, initial);
  const summary = useSummary(initial).data;
  const forecast = useForecast(initial).data;
  const suppliers = useSuppliers().data ?? [];
  const categories = useCategories().data ?? [];
  const detail = useDetail(openId);
  const actions = usePayableActions();
  const today = summary.today;
  const rows = useMemo(() => listing.data?.items ?? [], [listing.data]);
  const ordered = useMemo(() => groupRows(rows, filters.group, today).flatMap((g) => g.rows), [rows, filters.group, today]);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  // ---------- URL (compartilhável; replaceState não refaz a busca do servidor) ----------
  useEffect(() => {
    const p = filtersToParams(filters);
    if (openId) p.set('open', openId);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [filters, openId]);

  // ---------- filtros ----------
  const change = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected(new Set());
    setAnchor(null);
    setFocusedId(null);
    setLimit(PAGE);
  }, []);

  const changeView = useCallback(
    (v: Filters['view']) => change({ view: v, from: '', to: '', sort: v === 'paid' ? 'paid' : 'due', dir: v === 'paid' ? 'desc' : 'asc' }),
    [change],
  );

  const pickBucket = useCallback(
    (b: ForecastBucket) => {
      if (b.kind === 'overdue') return changeView(filters.view === 'overdue' ? 'open' : 'overdue');
      const active = filters.view === 'open' && filters.from === (b.from ?? '') && filters.to === (b.to ?? '');
      change(active ? { from: '', to: '' } : { view: 'open', from: b.from ?? '', to: b.to ?? '', sort: 'due', dir: 'asc' });
    },
    [change, changeView, filters],
  );

  // ---------- seleção ----------
  const toggle = useCallback(
    (id: string, shift: boolean) => {
      setSelected((cur) => {
        const next = new Set(cur);
        const ids = ordered.map((r) => r.id);
        if (shift && anchor && ids.includes(anchor)) {
          const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y) as [number, number];
          const turnOn = !cur.has(id);
          ids.slice(a, b + 1).forEach((i) => (turnOn ? next.add(i) : next.delete(i)));
        } else next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      setAnchor(id);
      setFocusedId(id);
    },
    [anchor, ordered],
  );

  // ---------- ações ----------
  const copy = useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({ title: what, tone: 'success', duration: 2500 });
      } catch {
        toast({ title: 'Não foi possível copiar', description: 'Selecione o texto e copie manualmente.', tone: 'error' });
      }
    },
    [toast],
  );

  const fail = (e: unknown) => toast({ title: 'Não deu certo', description: (e as Error).message, tone: 'error' });

  const startPay = useCallback(
    (list: PayableRow[]) => {
      const open = list.filter((r) => r.status === 'OPEN');
      if (open.length === 0) return toast({ title: 'Nenhuma conta em aberto na seleção', tone: 'info' });
      if (!access.pay) return toast({ title: 'Você não tem permissão para registrar pagamentos', tone: 'error' });
      setPayRows(open);
    },
    [access.pay, toast],
  );

  const submitPay = async (input: PayInput) => {
    const list = payRows!;
    try {
      if (list.length === 1) {
        const r = list[0]!;
        const paid = await actions.pay.mutateAsync({ id: r.id, ...input });
        toast({
          title: `Paga: ${r.supplierName}`,
          description: money(paid.paidAmount ?? r.amount),
          action: { label: 'Desfazer', onClick: () => actions.unpay.mutate(r.id, { onSuccess: () => toast({ title: 'Pagamento desfeito', tone: 'info', duration: 2500 }), onError: fail }) },
        });
      } else {
        const res = await actions.bulk.mutateAsync({ ids: list.map((r) => r.id), action: 'pay', paidAt: input.paidAt, method: input.method });
        toast({
          title: `${res.done.length} ${res.done.length === 1 ? 'conta paga' : 'contas pagas'}`,
          description: res.skipped.length ? `${res.skipped.length} já não estavam em aberto.` : money(sumAmounts(list.filter((r) => res.done.includes(r.id)))),
          action: { label: 'Desfazer', onClick: () => actions.bulk.mutate({ ids: res.done, action: 'unpay' }, { onSuccess: () => toast({ title: 'Pagamentos desfeitos', tone: 'info', duration: 2500 }), onError: fail }) },
        });
      }
      setPayRows(null);
      setSelected(new Set());
    } catch (e) {
      fail(e);
    }
  };

  const askCancel = (list: { id: string; supplierName: string }[]) =>
    setConfirm({
      title: list.length === 1 ? 'Cancelar esta conta?' : `Cancelar ${list.length} contas?`,
      description: list.length === 1 ? `${list[0]!.supplierName} deixa de contar como a pagar. Isso não pode ser desfeito.` : 'Elas deixam de contar como a pagar. Isso não pode ser desfeito.',
      label: list.length === 1 ? 'Cancelar conta' : 'Cancelar contas',
      run: () => {
        const done = () => {
          toast({ title: list.length === 1 ? 'Conta cancelada' : `${list.length} contas canceladas`, tone: 'info' });
          setSelected(new Set());
        };
        if (list.length === 1) actions.cancel.mutate(list[0]!.id, { onSuccess: done, onError: fail });
        else actions.bulk.mutate({ ids: list.map((r) => r.id), action: 'cancel' }, { onSuccess: done, onError: fail });
      },
    });

  const save = async (id: string, input: UpdateInput) => {
    await actions.update.mutateAsync({ id, ...input });
    toast({ title: 'Alterações salvas' });
  };

  const create = async (input: CreateInput, another: boolean) => {
    const created = await actions.create.mutateAsync(input);
    toast({ title: created.length > 1 ? `${created.length} parcelas lançadas` : 'Conta lançada', description: input.supplierName });
    if (!another) setComposerOpen(false);
  };

  // ---------- teclado ----------
  const kb = useRef({ ordered, focusedId, selected, selectedRows, filters });
  kb.current = { ordered, focusedId, selected, selectedRows, filters };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      const modal = document.querySelector('[role="dialog"]');
      const { ordered, focusedId, selected, selectedRows } = kb.current;
      const k = e.key;
      if (modal) return;

      const move = (delta: number) => {
        if (ordered.length === 0) return;
        const i = focusedId ? ordered.findIndex((r) => r.id === focusedId) : -1;
        const next = ordered[Math.min(ordered.length - 1, Math.max(0, i + delta))]!;
        setFocusedId(next.id);
        document.querySelector(`[data-row-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      const focused = ordered.find((r) => r.id === focusedId);

      if (k === 'j') (e.preventDefault(), move(1));
      else if (k === 'k') (e.preventDefault(), move(-1));
      else if (k === 'Enter' && focused) (e.preventDefault(), setOpenId(focused.id));
      else if (k === 'x' && focused) (e.preventDefault(), toggle(focused.id, false));
      else if (k === 'a') (e.preventDefault(), setSelected(new Set(ordered.map((r) => r.id))));
      else if (k === 'p') {
        e.preventDefault();
        startPay(selected.size > 0 ? selectedRows : focused ? [focused] : []);
      } else if (k === 'c' && access.manage) (e.preventDefault(), setComposerOpen(true));
      else if (k === 'f') (e.preventDefault(), searchRef.current?.focus());
      else if (k === '?') (e.preventDefault(), setHelpOpen(true));
      else if (k === 'Escape') (setSelected(new Set()), setFocusedId(null));
      else if (/^[1-6]$/.test(k)) (e.preventDefault(), changeView(VIEWS[Number(k) - 1]!));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [access.manage, changeView, startPay, toggle]);

  // ---------- render ----------
  const total = listing.data?.total ?? 0;
  const hasFilters = activeFilterCount(filters) > 0;
  const busy = actions.unpay.isPending || actions.cancel.isPending || actions.update.isPending;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contas a pagar</h1>
          <p className="text-sm text-muted-foreground">Parcelas lidas dos XMLs das notas de compra, mais as contas avulsas.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Atalhos de teclado" title="Atalhos de teclado (?)" onClick={() => setHelpOpen(true)} className="hidden sm:inline-flex">
            <Keyboard aria-hidden />
          </Button>
          {access.manage && (
            <Button onClick={() => setComposerOpen(true)} title="Nova conta (C)">
              <Plus aria-hidden /> Nova conta
            </Button>
          )}
        </div>
      </header>

      <Overview summary={summary} forecast={forecast} filters={filters} onView={changeView} onBucket={pickBucket} />

      <Toolbar filters={filters} summary={summary} suppliers={suppliers} categories={categories} today={today} searchRef={searchRef} onChange={change} />

      {listing.isError && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>
            Não foi possível atualizar a lista.{' '}
            <button className="font-medium underline" onClick={() => listing.refetch()}>
              Tentar de novo
            </button>
          </p>
        </div>
      )}

      <p className="-mb-2 text-xs text-muted-foreground" aria-live="polite">
        {total} {total === 1 ? 'conta' : 'contas'}
        {listing.data && ` · ${money(listing.data.totalAmount)}`}
        {rows.length < total && ` · mostrando ${rows.length}`}
      </p>

      <PayableList
        rows={rows}
        filters={filters}
        today={today}
        selected={selected}
        focusedId={focusedId}
        loading={listing.isFetching && listing.isPlaceholderData}
        hasFilters={hasFilters}
        onClearFilters={() => change({ ...DEFAULT_FILTERS, view: filters.view, group: filters.group, sort: filters.sort, dir: filters.dir })}
        onNew={() => access.manage && setComposerOpen(true)}
        onOpen={setOpenId}
        onToggle={toggle}
        onPay={(r) => startPay([r])}
        onCopyBarcode={(r) => r.barcode && copy(r.barcode, 'Linha digitável copiada')}
      />

      {rows.length < total && (
        <div className="flex flex-col items-center gap-1 pt-1">
          {limit < MAX ? (
            <Button variant="outline" onClick={() => setLimit((l) => Math.min(MAX, l + PAGE))} disabled={listing.isFetching}>
              Mostrar mais {Math.min(PAGE, total - rows.length)}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Mostrando as primeiras {MAX}. Refine os filtros ou exporte o CSV para ver o resto.</p>
          )}
        </div>
      )}

      <BulkBar
        count={selectedRows.length}
        amount={sumAmounts(selectedRows)}
        canPay={access.pay && selectedRows.some((r) => r.status === 'OPEN')}
        canManage={access.manage && selectedRows.some((r) => r.status === 'OPEN')}
        onPay={() => startPay(selectedRows)}
        onCancel={() => askCancel(selectedRows.filter((r) => r.status === 'OPEN'))}
        onClear={() => setSelected(new Set())}
      />

      <DetailSheet
        id={openId}
        detail={detail.data as PayableDetail | undefined}
        loading={detail.isLoading}
        today={today}
        categories={categories}
        perms={access}
        busy={busy}
        onClose={() => setOpenId(null)}
        onPay={(d) => startPay([d as unknown as PayableRow])}
        onUnpay={(d) =>
          actions.unpay.mutate(d.id, { onSuccess: () => toast({ title: 'Pagamento desfeito', tone: 'info', duration: 2500 }), onError: fail })
        }
        onCancel={(d) => askCancel([d])}
        onSave={save}
        onCopy={copy}
      />

      <ComposerSheet open={composerOpen} suppliers={suppliers} categories={categories} onClose={() => setComposerOpen(false)} onSubmit={create} />

      <PayDialog rows={payRows} onClose={() => setPayRows(null)} onSubmit={submitPay} pending={actions.pay.isPending || actions.bulk.isPending} />

      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>{confirm?.title}</DialogTitle>
          <DialogDescription className="mt-1">{confirm?.description}</DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                confirm?.run();
                setConfirm(null);
              }}
            >
              {confirm?.label}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
