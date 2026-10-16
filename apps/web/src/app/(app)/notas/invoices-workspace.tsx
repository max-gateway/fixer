'use client';

import { Keyboard, Loader2, PackageCheck, Search, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ToastProvider, useToast } from '@/components/ui/toaster';
import { money, nextAction, STAGES, SIDE_VIEWS, sumTotals, type InvoiceDetail, type InvoiceRow, type View } from '@/lib/invoices';
import { useCounts, useDetail, useInvoiceActions, useListing, useMediaQuery, useNow, usePrefetchDetail, useSyncStatus, type ActionKind, type BulkResult, type Initial } from './hooks';
import { InvoiceList } from './invoice-list';
import { Pipeline } from './pipeline';
import { PreviewEmpty, PreviewPane } from './preview-pane';
import { SyncStatus } from './sync-status';

export function InvoicesWorkspace(props: { initial: Initial }) {
  return (
    <ToastProvider>
      <Workspace {...props} />
    </ToastProvider>
  );
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

const SHORTCUTS: [string, string][] = [
  ['J / K', 'Próxima / anterior'],
  ['Enter', 'Abrir a nota completa'],
  ['X', 'Marcar a nota (Shift+clique marca um intervalo)'],
  ['A', 'Marcar todas as carregadas'],
  ['E', 'Ação principal: lançar entrada ou dar ciência'],
  ['/', 'Buscar'],
  ['1 – 7', 'Trocar de etapa'],
  ['Esc', 'Limpar seleção'],
  ['?', 'Esta ajuda'],
];

const VERB: Record<'confirm' | 'manifest', { one: string; many: (n: number) => string; done: (n: number) => string }> = {
  confirm: { one: 'Entrada lançada no estoque', many: (n) => `Lançar ${n === 1 ? 'a entrada' : `${n} entradas`}`, done: (n) => `${n} ${n === 1 ? 'entrada lançada' : 'entradas lançadas'} no estoque` },
  manifest: { one: 'Ciência registrada', many: (n) => `Dar ciência em ${n === 1 ? 'a nota' : `${n} notas`}`, done: (n) => `Ciência registrada em ${n} ${n === 1 ? 'nota' : 'notas'}` },
};

function Workspace({ initial }: { initial: Initial }) {
  const { toast } = useToast();
  const [view, setView] = useState<View>(initial.view);
  const [q, setQ] = useState(initial.q);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'confirm' | 'manifest'; rows: InvoiceRow[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const desktop = useMediaQuery('(min-width: 1024px)');
  const now = useNow();
  const listing = useListing(view, q, initial);
  const counts = useCounts(initial).data;
  const status = useSyncStatus(initial).data ?? null;
  const detail = useDetail(activeId);
  const prefetch = usePrefetchDetail();
  const actions = useInvoiceActions();

  const rows = useMemo(() => listing.data?.pages.flatMap((p) => p.items) ?? [], [listing.data]);
  const total = listing.data?.pages[0]?.total ?? 0;
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const pendingKind = actions.one.isPending ? actions.one.variables.kind : null;

  // ---------- URL compartilhável (replaceState não refaz a busca do servidor) ----------
  useEffect(() => {
    const p = new URLSearchParams();
    if (view !== 'pending') p.set('view', view);
    if (q) p.set('q', q);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [view, q]);

  const changeView = useCallback((v: View) => {
    setView(v);
    setSelected(new Set());
    setAnchor(null);
    setActiveId(null);
  }, []);

  const changeQuery = useCallback((next: string) => {
    setQ(next);
    setSelected(new Set());
    setActiveId(null);
  }, []);

  // Seleção some da vista quando a nota muda de etapa (ex.: acabou de ser lançada).
  useEffect(() => {
    if (activeId && !listing.isFetching && !listing.isPlaceholderData && rows.length > 0 && !rows.some((r) => r.id === activeId)) setActiveId(null);
  }, [rows, activeId, listing.isFetching, listing.isPlaceholderData]);

  // ---------- seleção ----------
  const toggle = useCallback(
    (id: string, shift: boolean) => {
      setSelected((cur) => {
        const next = new Set(cur);
        const ids = rows.map((r) => r.id);
        if (shift && anchor && ids.includes(anchor)) {
          const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y) as [number, number];
          const on = !cur.has(id);
          ids.slice(a, b + 1).forEach((i) => (on ? next.add(i) : next.delete(i)));
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchor(id);
    },
    [rows, anchor],
  );

  // ---------- ações ----------
  const fail = useCallback((e: unknown) => toast({ title: 'Não deu certo', description: (e as Error).message, tone: 'error' }), [toast]);

  const report = useCallback(
    (kind: 'confirm' | 'manifest', r: BulkResult) => {
      if (r.failed.length === 0) return toast({ title: VERB[kind].done(r.ok.length) });
      toast({
        title: r.ok.length ? `${VERB[kind].done(r.ok.length)}, ${r.failed.length} falharam` : `Nenhuma nota concluída (${r.failed.length})`,
        description: r.failed[0]!.message,
        tone: 'error',
        duration: 9000,
      });
    },
    [toast],
  );

  const runMany = useCallback(
    (kind: 'confirm' | 'manifest', list: InvoiceRow[]) => {
      actions.many.mutate({ kind, ids: list.map((r) => r.id) }, { onSuccess: (r) => (report(kind, r), setSelected(new Set())), onError: fail });
    },
    [actions.many, report, fail],
  );

  const runOne = useCallback(
    (kind: ActionKind, inv: Pick<InvoiceDetail, 'id' | 'issuerName'>) => {
      actions.one.mutate(
        { kind, id: inv.id },
        {
          onSuccess: (r) => {
            if (kind === 'manifest' && r.message) return toast({ title: 'A SEFAZ recusou a ciência', description: r.message, tone: 'error', duration: 9000 });
            toast({ title: kind === 'clear-review' ? 'Nota liberada' : VERB[kind].one, description: inv.issuerName });
          },
          onError: fail,
        },
      );
    },
    [actions.one, toast, fail],
  );

  /** Em lote pede confirmação (mexe no estoque ou fala com a SEFAZ); uma nota só vai direto. */
  const askMany = useCallback(
    (kind: 'confirm' | 'manifest', list: InvoiceRow[]) => {
      if (list.length === 0) return toast({ title: kind === 'confirm' ? 'Nenhuma nota pronta para lançar na seleção' : 'Nenhuma nota aguardando ciência na seleção', tone: 'info' });
      if (list.length === 1) return runOne(kind, list[0]!);
      setConfirm({ kind, rows: list });
    },
    [runOne, toast],
  );

  const confirmable = selectedRows.filter((r) => nextAction(r) === 'confirm');
  const manifestable = selectedRows.filter((r) => nextAction(r) === 'manifest');

  // ---------- teclado ----------
  const kb = useRef({ rows, activeId, selectedRows, desktop });
  kb.current = { rows, activeId, selectedRows, desktop };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
      const { rows, activeId, selectedRows, desktop } = kb.current;
      const k = e.key.toLowerCase();
      const current = rows.find((r) => r.id === activeId);
      const move = (delta: number) => {
        if (rows.length === 0) return;
        const i = activeId ? rows.findIndex((r) => r.id === activeId) : -1;
        const next = rows[Math.min(rows.length - 1, Math.max(0, i + delta))]!;
        setActiveId(next.id);
        document.querySelector(`[data-row-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      if (k === 'j' && desktop) (e.preventDefault(), move(1));
      else if (k === 'k' && desktop) (e.preventDefault(), move(-1));
      else if (k === 'enter' && current) (e.preventDefault(), (window.location.href = `/notas/${current.id}`));
      else if (k === 'x' && current) (e.preventDefault(), toggle(current.id, false));
      else if (k === 'a') (e.preventDefault(), setSelected(new Set(rows.map((r) => r.id))));
      else if (k === 'e') {
        const pool = selectedRows.length ? selectedRows : current ? [current] : [];
        const kind = pool.some((r) => nextAction(r) === 'confirm') ? 'confirm' : pool.some((r) => nextAction(r) === 'manifest') ? 'manifest' : null;
        if (kind) (e.preventDefault(), askMany(kind, pool.filter((r) => nextAction(r) === kind)));
      } else if (k === '/') (e.preventDefault(), searchRef.current?.focus());
      else if (k === '?') (e.preventDefault(), setHelpOpen(true));
      else if (k === 'escape') (setSelected(new Set()), setActiveId(null));
      else if (/^[1-7]$/.test(k)) (e.preventDefault(), changeView([...STAGES, ...SIDE_VIEWS][Number(k) - 1] as View));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askMany, changeView, toggle]);

  const preview = (
    <PreviewPane detail={detail.data} loading={detail.isLoading} error={detail.isError} pending={pendingKind} canAct onAction={(k, inv) => runOne(k, inv)} />
  );

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Notas de compra</h1>
            <p className="text-sm text-muted-foreground">NF-e emitidas contra o CNPJ da empresa, buscadas automaticamente na SEFAZ.</p>
          </div>
          <SyncStatus status={status} now={now} />
        </div>
        <Button variant="ghost" size="icon" aria-label="Atalhos de teclado" title="Atalhos de teclado (?)" onClick={() => setHelpOpen(true)} className="hidden sm:inline-flex">
          <Keyboard aria-hidden />
        </Button>
      </header>

      <Pipeline view={view} counts={counts} onView={changeView} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-3">
          <SearchBox value={q} inputRef={searchRef} onCommit={changeQuery} />

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

          <p className="text-xs text-muted-foreground" aria-live="polite">
            {total} {total === 1 ? 'nota' : 'notas'}
            {rows.length > 0 && ` · ${money(sumTotals(rows))}`}
            {rows.length < total && ` · mostrando ${rows.length}`}
          </p>

          <InvoiceList
            rows={rows}
            view={view}
            filtered={Boolean(q)}
            loading={listing.isFetching && listing.isPlaceholderData}
            activeId={activeId}
            focusedId={null}
            selected={selected}
            onOpen={setActiveId}
            onToggle={toggle}
            onHover={prefetch}
          />

          {listing.hasNextPage && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" onClick={() => listing.fetchNextPage()} disabled={listing.isFetchingNextPage}>
                {listing.isFetchingNextPage && <Loader2 aria-hidden className="animate-spin" />} Mostrar mais {Math.min(50, total - rows.length)}
              </Button>
            </div>
          )}
        </div>

        {desktop && <aside aria-label="Detalhe da nota" className="sticky top-4 flex max-h-[calc(100dvh-2rem)] min-h-80 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">{activeId ? preview : <PreviewEmpty />}</aside>}
      </div>

      {!desktop && (
        <Sheet open={!!activeId} onOpenChange={(o) => !o && setActiveId(null)}>
          <SheetContent className="min-h-[60dvh]">
            <SheetTitle className="sr-only">Nota de compra</SheetTitle>
            <SheetDescription className="sr-only">Detalhes e ação principal da nota selecionada.</SheetDescription>
            {preview}
          </SheetContent>
        </Sheet>
      )}

      {selected.size > 0 && (
        <div role="region" aria-label="Ações em lote" className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 sm:bottom-6">
          <div className="flex max-w-full animate-rise flex-wrap items-center gap-2 rounded-2xl border bg-foreground px-3 py-2 text-background shadow-xl">
            <span className="px-1 text-sm font-medium">
              {selected.size} {selected.size === 1 ? 'selecionada' : 'selecionadas'} <span className="tabular opacity-70">· {money(sumTotals(selectedRows))}</span>
            </span>
            {confirmable.length > 0 && (
              <Button size="sm" onClick={() => askMany('confirm', confirmable)} disabled={actions.many.isPending}>
                <PackageCheck aria-hidden /> Lançar {confirmable.length}
              </Button>
            )}
            {manifestable.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => askMany('manifest', manifestable)} disabled={actions.many.isPending}>
                <ShieldCheck aria-hidden /> Dar ciência em {manifestable.length}
              </Button>
            )}
            {confirmable.length === 0 && manifestable.length === 0 && <span className="text-xs opacity-70">Nenhuma ação em lote para estas notas</span>}
            <button type="button" onClick={() => setSelected(new Set())} aria-label="Limpar seleção" className="grid size-8 place-items-center rounded-md hover:bg-background/15 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>{confirm && VERB[confirm.kind].many(confirm.rows.length)}?</DialogTitle>
          <DialogDescription className="mt-1">
            {confirm?.kind === 'confirm'
              ? `As peças das ${confirm.rows.length} notas (${money(sumTotals(confirm.rows))}) entram no estoque e o custo é atualizado. Cada nota é lançada separadamente.`
              : 'A SEFAZ registra a ciência da operação e libera o XML completo. Isso não confirma o recebimento da mercadoria.'}
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Voltar
            </Button>
            <Button
              onClick={() => {
                if (confirm) runMany(confirm.kind, confirm.rows);
                setConfirm(null);
              }}
            >
              {confirm && VERB[confirm.kind].many(confirm.rows.length)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogTitle>Atalhos de teclado</DialogTitle>
          <DialogDescription className="sr-only">Lista de atalhos da tela de notas de compra.</DialogDescription>
          <dl className="mt-3 divide-y text-sm">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2">
                <dt className="text-muted-foreground">{d}</dt>
                <dd>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-xs">{k}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SearchBox({ value, inputRef, onCommit }: { value: string; inputRef: React.Ref<HTMLInputElement>; onCommit: (q: string) => void }) {
  const [text, setText] = useState(value);
  // Debounce: filtra enquanto digita, sem uma requisição por tecla.
  useEffect(() => {
    if (text.trim() === value) return;
    const id = setTimeout(() => onCommit(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text, value, onCommit]);
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (setText(''), onCommit(''), e.currentTarget.blur())}
        placeholder="Buscar por fornecedor, CNPJ, número ou chave  ( / )"
        aria-label="Buscar notas"
        className="h-11 pl-9 text-[15px]"
      />
    </div>
  );
}
