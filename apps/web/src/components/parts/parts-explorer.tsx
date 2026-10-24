'use client';

import {
  ArrowRight,
  Barcode,
  Car,
  ChevronLeft,
  ChevronRight,
  Command,
  GitCompareArrows,
  History,
  LayoutGrid,
  List,
  Repeat2,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PartImage } from '@/components/catalog/part-image';
import { Kbd } from '@/components/nav/kbd';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ToastProvider } from '@/components/ui/toaster';
import {
  activeFilters,
  isSearchable,
  PAGE_SIZE,
  pushRecent,
  RANK_WINDOW,
  toggle,
  toPageParams,
  type Application,
  type PartHit,
  type SearchState,
  type Suggestion,
  type VehicleFilter,
} from '@/lib/part-search';
import { cn } from '@/lib/utils';
import { CompareDialog } from './compare-dialog';
import { FacetPanel } from './facets';
import { CardSkeleton, PartCard, useCopy, type CardView } from './part-card';
import { PartSheet } from './part-sheet';
import { SearchBar } from './search-bar';
import { usePartSearch, useStored } from './use-parts';

const MAX_COMPARE = 4;
const EXAMPLES = ['bieleta estabilizadora', 'pastilha de freio dianteira', 'filtro de óleo', 'amortecedor traseiro', '7891234567890'];
const DEBOUNCE_MS = 250;

const SHORTCUTS: [string[], string][] = [
  [['/'], 'Ir para a busca'],
  [['↑', '↓'], 'Navegar nas sugestões'],
  [['j', 'k'], 'Próxima / anterior peça da lista'],
  [['Enter'], 'Abrir a peça selecionada'],
  [['c'], 'Copiar o código da peça selecionada'],
  [['x'], 'Marcar a peça para comparar'],
  [['v'], 'Alternar entre grade e lista'],
  [['['], 'Página anterior'],
  [[']'], 'Próxima página'],
  [['Esc'], 'Fechar ou limpar a busca'],
  [['?'], 'Mostrar esta ajuda'],
];

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
}

export function PartsExplorer({ initial }: { initial: SearchState }) {
  return (
    <ToastProvider>
      <Explorer initial={initial} />
    </ToastProvider>
  );
}

function Explorer({ initial }: { initial: SearchState }) {
  const [state, setState] = useState<SearchState>(initial);
  const [input, setInput] = useState(initial.q);
  const [view, setView] = useStored<CardView>('pecas:view', 'grid');
  const [recents, setRecents] = useStored<string[]>('pecas:recentes', []);
  const [compare, setCompare] = useState<PartHit[]>([]);
  const [selected, setSelected] = useState(-1);
  const [dialog, setDialog] = useState<null | 'compare' | 'shortcuts' | 'filters'>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const copy = useCopy();

  const search = usePartSearch(state);
  const result = isSearchable(state) ? search.data : undefined;
  const hits = result?.data ?? [];

  // --- estado: URL, busca com debounce, recentes ---------------------------------------------------------------------
  useEffect(() => {
    const qs = toPageParams(state).toString();
    window.history.replaceState(window.history.state, '', qs ? `?${qs}` : window.location.pathname);
  }, [state]);

  useEffect(() => {
    if (input.trim() === state.q.trim()) return;
    const t = setTimeout(() => setState((s) => ({ ...s, q: input, page: 1 })), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, state.q]);

  useEffect(() => setSelected(-1), [search.data]);

  const remember = useCallback((q: string) => setRecents((r) => pushRecent(r, q)), [setRecents]);
  const patch = useCallback((p: Partial<SearchState>) => setState((s) => ({ ...s, page: 1, ...p })), []);
  const submit = useCallback(
    (q: string) => {
      setInput(q);
      patch({ q });
      remember(q);
    },
    [patch, remember],
  );
  const goPage = useCallback(
    (page: number) => {
      setState((s) => ({ ...s, page }));
      top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [],
  );
  const openPart = useCallback(
    (sku: string) => {
      setState((s) => ({ ...s, sku }));
      remember(state.q);
    },
    [remember, state.q],
  );
  const closePart = useCallback(() => setState((s) => ({ ...s, sku: undefined })), []);
  const searchCode = useCallback(
    (code: string) => {
      setInput(code);
      setState((s) => ({ q: code, page: 1, brands: [], categories: [], ...(s.vehicle ? { vehicle: s.vehicle } : {}) }));
      remember(code);
    },
    [remember],
  );
  const setVehicle = useCallback((vehicle: VehicleFilter | undefined) => setState((s) => ({ ...s, page: 1, sku: undefined, vehicle })), []);
  const pickVehicle = useCallback((a: Application) => setVehicle({ id: a.vehicleId, make: a.make, model: a.model, label: a.vehicleName }), [setVehicle]);
  const clearFilters = () => patch({ brands: [], categories: [], vehicle: undefined });

  const toggleCompare = useCallback((hit: PartHit) => setCompare((c) => (c.some((x) => x.sku === hit.sku) ? c.filter((x) => x.sku !== hit.sku) : c.length >= MAX_COMPARE ? c : [...c, hit])), []);

  // --- atalhos de teclado --------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || dialog) return;
      const sheetOpen = Boolean(state.sku);
      const move = (delta: number) => {
        if (hits.length === 0) return;
        const next = Math.min(hits.length - 1, Math.max(0, selected + delta));
        setSelected(next);
        if (sheetOpen) setState((s) => ({ ...s, sku: hits[next]!.sku }));
        else document.querySelector(`[data-hit="${CSS.escape(hits[next]!.sku)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      switch (e.key) {
        case '/':
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
          break;
        case '?':
          setDialog('shortcuts');
          break;
        case 'j':
          move(selected === -1 && sheetOpen ? hits.findIndex((h) => h.sku === state.sku) + 1 : 1);
          break;
        case 'k':
          move(selected === -1 && sheetOpen ? hits.findIndex((h) => h.sku === state.sku) - 1 : -1);
          break;
        default:
          if (sheetOpen) return;
          if (e.key === 'Enter' && hits[selected]) openPart(hits[selected]!.sku);
          else if (e.key === 'c' && hits[selected]) void copy(hits[selected]!.partNumber, 'Código');
          else if (e.key === 'x' && hits[selected]) toggleCompare(hits[selected]!);
          else if (e.key === 'v') setView((v) => (v === 'grid' ? 'list' : 'grid'));
          else if (e.key === '[' && state.page > 1) goPage(state.page - 1);
          else if (e.key === ']' && result && state.page < result.totalPages) goPage(state.page + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, hits, selected, state.sku, state.page, result, openPart, copy, toggleCompare, setView, goPage]);

  // --- derivados -----------------------------------------------------------------------------------------------------
  const filters = activeFilters(state, result?.facets);
  const filterCount = filters.length;
  const sheetHit = hits.find((h) => h.sku === state.sku) ?? compare.find((h) => h.sku === state.sku);
  const sheetIndex = hits.findIndex((h) => h.sku === state.sku);
  const settling = input.trim() !== state.q.trim();
  const busy = settling || (isSearchable(state) && search.isFetching);
  const from = result ? (result.page - 1) * result.limit + 1 : 0;
  const manualVehicleWithText = state.vehicle && !state.vehicle.id && state.q.trim().length > 0;

  function removeFilter(kind: 'brand' | 'category' | 'vehicle', value: string) {
    if (kind === 'vehicle') setVehicle(undefined);
    else if (kind === 'brand') patch({ brands: state.brands.filter((b) => b !== value) });
    else patch({ categories: state.categories.filter((c) => c !== value) });
  }

  const facetPanel = (
    <FacetPanel
      facets={result?.facets}
      brands={state.brands}
      categories={state.categories}
      onToggleBrand={(k) => patch({ brands: toggle(state.brands, k) })}
      onToggleCategory={(c) => patch({ categories: toggle(state.categories, c) })}
    />
  );
  const hasFacets = Boolean(result && (result.facets.brands.length > 0 || result.facets.categories.length > 0)) || state.brands.length > 0 || state.categories.length > 0;

  return (
    <div ref={top} className="scroll-mt-20 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Catálogo de peças</h1>
          <p className="text-sm text-muted-foreground">Busque por nome, código, equivalente ou código de barras e veja onde a peça serve e como ela se comportou na oficina.</p>
        </div>
        <div className="flex items-center gap-2">
          <VehiclePopover vehicle={state.vehicle} onApply={setVehicle} />
          <Button variant="outline" size="sm" onClick={() => setDialog('shortcuts')} aria-label="Atalhos de teclado">
            <Command aria-hidden /> <span className="hidden sm:inline">Atalhos</span> <Kbd className="text-muted-foreground">?</Kbd>
          </Button>
        </div>
      </header>

      <SearchBar value={input} onChange={setInput} onSubmit={submit} onPick={(s: Suggestion) => { setInput(s.partNumber); setState((st) => ({ ...st, q: s.partNumber, page: 1, brands: [], categories: [], sku: s.sku })); remember(s.partNumber); }} recents={recents} onClearRecents={() => setRecents([])} busy={busy} inputRef={inputRef} />

      {manualVehicleWithText && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            O veículo “{state.vehicle!.label}” não está filtrando a busca por texto. Apague o texto para ver as peças dele, ou abra uma peça e use a aba Veículos para escolher o modelo exato.
          </span>
        </p>
      )}

      {!isSearchable(state) ? (
        <Welcome recents={recents} onPick={submit} />
      ) : (
        <div className={cn('grid gap-6', hasFacets && 'lg:grid-cols-[15.5rem_minmax(0,1fr)]')}>
          {hasFacets && (
            <aside aria-label="Filtros" className="hidden lg:block">
              <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pr-1">{facetPanel}</div>
            </aside>
          )}
          <section aria-label="Resultados" className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {result ? (
                  result.total === 0 ? (
                    'Nenhuma peça encontrada'
                  ) : (
                    <>
                      <strong className="font-semibold text-foreground">{result.total.toLocaleString('pt-BR')}</strong> {result.total === 1 ? 'peça' : 'peças'}
                      {result.totalPages > 1 && <span className="tabular"> · {from}–{from + hits.length - 1}</span>}
                    </>
                  )
                ) : search.isError ? (
                  ''
                ) : (
                  'Buscando…'
                )}
              </p>
              <div className="ml-auto flex items-center gap-2">
                {hasFacets && (
                  <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setDialog('filters')}>
                    <SlidersHorizontal aria-hidden /> Filtros{filterCount > 0 && <span className="rounded-full bg-brand px-1.5 text-[0.65rem] text-primary-foreground">{filterCount}</span>}
                  </Button>
                )}
                <div role="group" aria-label="Modo de exibição" className="flex rounded-lg border bg-card p-0.5">
                  {(
                    [
                      ['grid', LayoutGrid, 'Grade'],
                      ['list', List, 'Lista'],
                    ] as const
                  ).map(([v, Icon, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      aria-pressed={view === v}
                      aria-label={label}
                      title={`${label} (v)`}
                      className={cn('grid size-7 place-items-center rounded-md text-muted-foreground transition-colors', view === v ? 'bg-brand text-primary-foreground' : 'hover:text-foreground')}
                    >
                      <Icon aria-hidden className="size-4" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filterCount > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {filters.map((f) => (
                  <button
                    key={`${f.kind}:${f.value}`}
                    type="button"
                    onClick={() => removeFilter(f.kind, f.value)}
                    className="group inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pr-2 pl-3 text-xs font-medium hover:border-destructive/40 hover:text-destructive"
                  >
                    {f.kind === 'vehicle' && <Car aria-hidden className="size-3.5" />}
                    {f.label}
                    <X aria-label="Remover filtro" className="size-3.5 text-muted-foreground group-hover:text-destructive" />
                  </button>
                ))}
                <button type="button" onClick={clearFilters} className="px-1 text-xs font-medium text-brand hover:underline">
                  Limpar tudo
                </button>
              </div>
            )}

            {search.isError && !result ? (
              <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
                <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
                <div className="space-y-2">
                  <p className="font-semibold">{search.error.message}</p>
                  <p>Verifique a conexão e tente de novo. Se continuar, o catálogo pode estar fora do ar.</p>
                  <Button variant="outline" size="sm" onClick={() => search.refetch()}>
                    Tentar de novo
                  </Button>
                </div>
              </div>
            ) : !result ? (
              <Grid view={view}>
                {Array.from({ length: 8 }, (_, i) => (
                  <CardSkeleton key={i} view={view} />
                ))}
              </Grid>
            ) : hits.length === 0 ? (
              <NoResults query={state.q} filtered={filterCount > 0} onClear={clearFilters} onExample={submit} />
            ) : (
              <>
                <div className={cn('transition-opacity', search.isFetching && 'opacity-60')} aria-busy={search.isFetching}>
                  <Grid view={view}>
                    {hits.map((h, i) => (
                      <PartCard
                        key={h.sku}
                        hit={h}
                        index={i}
                        query={state.q}
                        view={view}
                        selected={i === selected}
                        comparing={compare.some((c) => c.sku === h.sku)}
                        compareDisabled={compare.length >= MAX_COMPARE}
                        onOpen={() => {
                          setSelected(i);
                          openPart(h.sku);
                        }}
                        onToggleCompare={() => toggleCompare(h)}
                        onBrand={h.brand ? () => patch({ brands: toggle(state.brands, h.brand!.key) }) : undefined}
                      />
                    ))}
                  </Grid>
                </div>
                {result.truncated && (
                  <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                    <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" />
                    Mostrando as {RANK_WINDOW} mais relevantes de {result.total.toLocaleString('pt-BR')}. Para chegar às outras, refine com marca, categoria ou um código.
                  </p>
                )}
                <Pagination page={result.page} pages={result.totalPages} onPage={goPage} />
              </>
            )}
          </section>
        </div>
      )}

      {compare.length > 0 && (
        <div role="region" aria-label="Comparação" className="surface animate-rise fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border bg-card p-2.5 md:bottom-6">
          <div className="flex -space-x-2">
            {compare.map((c) => (
              <PartImage key={c.sku} url={c.imageUrl} className="size-10 rounded-lg border-2 border-card bg-white" />
            ))}
          </div>
          <p className="min-w-0 flex-1 text-sm">
            <strong>{compare.length}</strong> {compare.length === 1 ? 'peça marcada' : 'peças marcadas'}
            {compare.length < 2 && <span className="block text-xs text-muted-foreground">Marque mais uma para comparar</span>}
          </p>
          <Button size="sm" disabled={compare.length < 2} onClick={() => setDialog('compare')}>
            <GitCompareArrows aria-hidden /> Comparar
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setCompare([])} aria-label="Limpar comparação">
            <X aria-hidden />
          </Button>
        </div>
      )}

      <PartSheet
        sku={state.sku}
        hit={sheetHit}
        onClose={closePart}
        onSearchCode={(code) => {
          searchCode(code);
          inputRef.current?.focus();
        }}
        onVehicle={pickVehicle}
        onPrev={sheetIndex > 0 ? () => { setSelected(sheetIndex - 1); setState((s) => ({ ...s, sku: hits[sheetIndex - 1]!.sku })); } : undefined}
        onNext={sheetIndex >= 0 && sheetIndex < hits.length - 1 ? () => { setSelected(sheetIndex + 1); setState((s) => ({ ...s, sku: hits[sheetIndex + 1]!.sku })); } : undefined}
      />

      <CompareDialog
        open={dialog === 'compare' && compare.length > 0}
        onOpenChange={(o) => !o && setDialog(null)}
        hits={compare}
        onOpenPart={(sku) => {
          setDialog(null);
          openPart(sku);
        }}
        onRemove={(sku) => {
          setCompare((c) => c.filter((x) => x.sku !== sku));
          if (compare.length <= 2) setDialog(null);
        }}
      />

      <Sheet open={dialog === 'filters'} onOpenChange={(o) => !o && setDialog(null)}>
        <SheetContent className="sm:max-w-sm">
          <div className="border-b p-5 pr-14">
            <SheetTitle>Filtros</SheetTitle>
            <SheetDescription>{result ? `${result.total.toLocaleString('pt-BR')} peças` : ''}</SheetDescription>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{facetPanel}</div>
          <div className="flex gap-2 border-t p-3">
            <Button variant="outline" className="flex-1" onClick={clearFilters} disabled={filterCount === 0}>
              Limpar
            </Button>
            <Button className="flex-1" onClick={() => setDialog(null)}>
              Ver {result ? result.total.toLocaleString('pt-BR') : ''} peças
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={dialog === 'shortcuts'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Atalhos de teclado</DialogTitle>
          <DialogDescription className="mb-3">Funcionam fora dos campos de texto.</DialogDescription>
          <dl className="divide-y text-sm">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2">
                <dt>{label}</dt>
                <dd className="flex gap-1">
                  {keys.map((k) => (
                    <Kbd key={k} className="text-muted-foreground">
                      {k}
                    </Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Grid({ view, children }: { view: CardView; children: React.ReactNode }) {
  return <div className={cn('grid gap-3', view === 'grid' ? 'sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1')}>{children}</div>;
}

/** Janela de páginas: a primeira, a última e três em volta da atual, com reticências. */
function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const list = [...set].sort((a, b) => a - b);
  return (
    <nav aria-label="Páginas" className="flex items-center justify-center gap-1 pt-2">
      <Button variant="ghost" size="icon-sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Página anterior">
        <ChevronLeft aria-hidden />
      </Button>
      {list.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && p - list[i - 1]! > 1 && <span className="px-1 text-muted-foreground">…</span>}
          <button
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn('tabular grid h-8 min-w-8 place-items-center rounded-md px-2 text-sm', p === page ? 'bg-brand font-semibold text-primary-foreground' : 'hover:bg-muted')}
          >
            {p}
          </button>
        </span>
      ))}
      <Button variant="ghost" size="icon-sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Próxima página">
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}

function NoResults({ query, filtered, onClear, onExample }: { query: string; filtered: boolean; onClear: () => void; onExample: (q: string) => void }) {
  return (
    <div className="surface rounded-2xl border bg-card p-8 text-center">
      <SearchX aria-hidden className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="font-semibold">{query.trim() ? `Nada encontrado para “${query.trim()}”` : 'Nenhuma peça para este veículo'}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {filtered ? 'Os filtros podem estar escondendo resultados.' : 'Confira a grafia, tente só parte do nome ou o código sem hífen.'}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {filtered && (
          <Button size="sm" onClick={onClear}>
            Limpar filtros
          </Button>
        )}
        {EXAMPLES.slice(0, 3).map((e) => (
          <Button key={e} size="sm" variant="outline" onClick={() => onExample(e)}>
            {e}
          </Button>
        ))}
      </div>
    </div>
  );
}

const TIPS = [
  { icon: Repeat2, title: 'Equivalentes', text: 'Ache a mesma peça em outras marcas pelos códigos de cross-reference.' },
  { icon: Car, title: 'Compatibilidade', text: 'Veja todos os veículos em que a peça serve, por montadora, modelo e ano.' },
  { icon: Barcode, title: 'Código de barras', text: 'Digite o GTIN ou leia a caixa com a câmera.' },
  { icon: History, title: 'Compra e venda', text: 'Custo, preço e uso da peça nas suas ordens de serviço.' },
];

function Welcome({ recents, onPick }: { recents: string[]; onPick: (q: string) => void }) {
  return (
    <div className="space-y-8 pt-2">
      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">{recents.length > 0 ? 'Continue de onde parou' : 'Experimente buscar'}</p>
        <div className="flex flex-wrap gap-2">
          {(recents.length > 0 ? recents : EXAMPLES).map((q) => (
            <button key={q} type="button" onClick={() => onPick(q)} className="group inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-sm shadow-xs hover:border-ring/50 hover:bg-accent">
              {q}
              <ArrowRight aria-hidden className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
            </button>
          ))}
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TIPS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="surface rounded-2xl border bg-card p-4">
            <span className="mb-3 grid size-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <Icon aria-hidden className="size-4.5" />
            </span>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Busca de peças de um veículo por montadora e modelo, sem precisar de texto (usa a lista por veículo da plataforma). */
function VehiclePopover({ vehicle, onApply }: { vehicle?: VehicleFilter; onApply: (v: VehicleFilter | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const canApply = make.trim().length > 0;
  const label = useMemo(() => [make.trim(), model.trim()].filter(Boolean).join(' '), [make, model]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={vehicle ? 'secondary' : 'outline'} size="sm">
          <Car aria-hidden /> <span className="max-w-40 truncate">{vehicle ? vehicle.label : 'Por veículo'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canApply) return;
            onApply({ make: make.trim(), ...(model.trim() ? { model: model.trim() } : {}), label });
            setOpen(false);
          }}
        >
          <p className="text-sm font-medium">Peças de um veículo</p>
          {(
            [
              ['Montadora', make, setMake, 'Fiat'],
              ['Modelo (opcional)', model, setModel, 'Strada'],
            ] as const
          ).map(([l, v, set, ph]) => (
            <label key={l} className="block space-y-1 text-xs font-medium">
              {l}
              <input value={v} onChange={(e) => set(e.target.value)} placeholder={ph} className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20" />
            </label>
          ))}
          <div className="flex gap-2">
            {vehicle && (
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => { onApply(undefined); setMake(''); setModel(''); setOpen(false); }}>
                Remover
              </Button>
            )}
            <Button type="submit" size="sm" className="flex-1" disabled={!canApply}>
              Ver peças
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Dica: na ficha de uma peça, a aba Veículos filtra pelo modelo exato e funciona junto com o texto da busca.</p>
        </form>
      </PopoverContent>
    </Popover>
  );
}
