'use client';

import { Command, Sparkles, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Kbd } from '@/components/nav/kbd';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ToastProvider } from '@/components/ui/toaster';
import {
  activeFilters,
  pushRecent,
  RANK_WINDOW,
  searchText,
  sourceOf,
  toggle,
  toPageParams,
  yearRange,
  type Application,
  type Availability,
  type PartHit,
  type SearchState,
  type Suggestion,
  type VehicleFilter,
} from '@/lib/part-search';
import { cn } from '@/lib/utils';
import { CompareBar, MAX_COMPARE } from './compare-bar';
import { CompareDialog } from './compare-dialog';
import { NoResults, NoWorkshopParts, Welcome } from './empty-states';
import { FacetPanel } from './facets';
import { Pagination } from './pagination';
import { CardSkeleton, PartCard, useCopy, type CardView } from './part-card';
import { PartSheet } from './part-sheet';
import { ActiveFilters, AvailabilityFilter, FiltersButton, ViewToggle } from './results-toolbar';
import { SearchBar } from './search-bar';
import { ShortcutsDialog } from './shortcuts-dialog';
import { usePartSearch, useStored, useWorkshopStock } from './use-parts';
import { VehicleBar } from './vehicle-picker';

const DEBOUNCE_MS = 250;

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

/**
 * Peças: uma tela só para consultar o catálogo e o estoque. Abre no estoque da oficina; digitar busca no catálogo inteiro, e cada peça diz o que a
 * oficina tem dela; o veículo (placa ou modelo) restringe tudo ao que serve. "Na oficina" e "Com saldo" são filtros, não outra tela.
 */
function Explorer({ initial }: { initial: SearchState }) {
  const [state, setState] = useState<SearchState>(initial);
  const [input, setInput] = useState(initial.q);
  const [view, setView] = useStored<CardView>('pecas:view', 'list');
  const [recents, setRecents] = useStored<string[]>('pecas:recentes', []);
  const [compare, setCompare] = useState<PartHit[]>([]);
  const [selected, setSelected] = useState(-1);
  const [dialog, setDialog] = useState<null | 'compare' | 'shortcuts' | 'filters' | 'vehicle'>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const copy = useCopy();

  const source = sourceOf(state);
  const search = usePartSearch(state);
  const result = search.data;
  const hits = result?.data ?? [];
  // A lista da oficina já traz o estoque de cada peça; nas listas do catálogo ele é buscado à parte, em lote.
  const stock = useWorkshopStock(source === 'workshop' ? [] : hits.map((h) => h.sku));

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
  const goPage = useCallback((page: number) => {
    setState((s) => ({ ...s, page }));
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const openPart = useCallback(
    (sku: string) => {
      setState((s) => ({ ...s, sku }));
      remember(state.q);
    },
    [remember, state.q],
  );
  const closePart = useCallback(() => setState((s) => ({ ...s, sku: undefined })), []);
  /** Código vindo da ficha (equivalente, OEM, GTIN): busca no catálogo inteiro, que é quem entende código. */
  const searchCode = useCallback(
    (code: string) => {
      setInput(code);
      setState((s) => ({ q: code, page: 1, brands: [], categories: [], avail: 'all', ...(s.vehicle ? { vehicle: s.vehicle } : {}) }));
      remember(code);
    },
    [remember],
  );
  const setVehicle = useCallback((vehicle: VehicleFilter | undefined) => setState((s) => ({ ...s, page: 1, sku: undefined, vehicle })), []);
  const pickApplication = useCallback(
    (a: Application) => setVehicle({ id: a.vehicleId, label: [a.vehicleName, a.yearFrom || a.yearTo ? yearRange(a.yearFrom, a.yearTo) : ''].filter(Boolean).join(' · ') }),
    [setVehicle],
  );
  /** Marca e categoria são do catálogo: na lista da oficina não existem, então trocar para ela as limpa (nada de filtro escondido). */
  const setAvail = useCallback((avail: Availability) => setState((s) => ({ ...s, page: 1, avail, ...(avail === 'all' ? {} : { brands: [], categories: [] }) })), []);
  const clearFilters = () => patch({ brands: [], categories: [] });

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
          else if (e.key === 'e') setDialog('vehicle');
          else if (e.key === '[' && state.page > 1) goPage(state.page - 1);
          else if (e.key === ']' && result && state.page < result.totalPages) goPage(state.page + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, hits, selected, state.sku, state.page, result, openPart, copy, toggleCompare, setView, goPage]);

  // --- derivados -----------------------------------------------------------------------------------------------------
  const text = searchText(state);
  const catalog = source === 'catalog';
  const filters = catalog ? activeFilters(state, result?.facets) : [];
  const sheetHit = hits.find((h) => h.sku === state.sku) ?? compare.find((h) => h.sku === state.sku);
  const sheetIndex = hits.findIndex((h) => h.sku === state.sku);
  const settling = input.trim() !== state.q.trim();
  const busy = settling || search.isFetching;
  const from = result ? (result.page - 1) * result.limit + 1 : 0;
  const hasFacets = catalog && (Boolean(result && (result.facets.brands.length > 0 || result.facets.categories.length > 0)) || state.brands.length > 0 || state.categories.length > 0);
  const stockLoading = source !== 'workshop' && !stock.data && (stock.isPending || stock.isFetching);
  // Primeira vez: nada digitado, nenhum filtro e a oficina ainda sem estoque.
  const firstRun = source === 'workshop' && !text && state.avail === 'all' && result?.total === 0;

  const heading =
    source === 'workshop' ? (state.avail === 'stock' ? 'Com saldo na oficina' : text ? 'Na oficina' : 'Estoque da oficina') : source === 'vehicle' ? `Peças para ${state.vehicle!.label}` : 'Catálogo';

  function removeFilter(kind: 'brand' | 'category', value: string) {
    if (kind === 'brand') patch({ brands: state.brands.filter((b) => b !== value) });
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

  return (
    <div ref={top} className="scroll-mt-20 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Peças</h1>
          <p className="text-sm text-muted-foreground">Catálogo e estoque da oficina, numa busca só.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDialog('shortcuts')} aria-label="Atalhos de teclado">
          <Command aria-hidden /> <span className="hidden sm:inline">Atalhos</span> <Kbd className="text-muted-foreground">?</Kbd>
        </Button>
      </header>

      <div className="grid gap-2 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <VehicleBar vehicle={state.vehicle} onChange={setVehicle} open={dialog === 'vehicle'} onOpenChange={(o) => setDialog(o ? 'vehicle' : null)} />
        <SearchBar
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onPick={(s: Suggestion) => {
            setInput(s.partNumber);
            setState((st) => ({ ...st, q: s.partNumber, page: 1, brands: [], categories: [], avail: 'all', sku: s.sku }));
            remember(s.partNumber);
          }}
          recents={recents}
          onClearRecents={() => setRecents([])}
          busy={busy}
          inputRef={inputRef}
          placeholder={state.vehicle ? `Buscar peça para ${state.vehicle.label}` : undefined}
          {...(state.vehicle ? { vehicleId: state.vehicle.id } : {})}
        />
      </div>

      {firstRun ? (
        <Welcome recents={recents} onPick={submit} onVehicle={() => setDialog('vehicle')} />
      ) : (
        <div className={cn('grid gap-6', hasFacets && 'lg:grid-cols-[14rem_minmax(0,1fr)]')}>
          {hasFacets && (
            <aside aria-label="Filtros" className="hidden lg:block">
              <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pr-1">{facetPanel}</div>
            </aside>
          )}
          <section aria-label="Resultados" className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div aria-live="polite" className="min-w-0">
                <h2 className="text-sm font-semibold">{heading}</h2>
                <p className="text-sm text-muted-foreground">
                  {result ? (
                    result.total === 0 ? (
                      'Nenhuma peça'
                    ) : (
                      <>
                        <strong className="font-semibold text-foreground">{result.total.toLocaleString('pt-BR')}</strong> {result.total === 1 ? 'peça' : 'peças'}
                        {result.totalPages > 1 && (
                          <span className="tabular">
                            {' '}
                            · {from}–{from + hits.length - 1}
                          </span>
                        )}
                      </>
                    )
                  ) : search.isError ? (
                    ''
                  ) : (
                    'Buscando…'
                  )}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <AvailabilityFilter value={state.avail} onChange={setAvail} disabled={Boolean(state.vehicle)} />
                {hasFacets && <FiltersButton count={filters.length} onClick={() => setDialog('filters')} />}
                <ViewToggle view={view} onChange={setView} />
              </div>
            </div>

            <ActiveFilters filters={filters} onRemove={removeFilter} onClear={clearFilters} />

            {search.isError && !result ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertDescription>
                  <p className="font-semibold">{search.error.message}</p>
                  <p>Verifique a conexão e tente de novo. Se continuar, o catálogo pode estar fora do ar.</p>
                  <Button variant="outline" size="sm" onClick={() => search.refetch()}>
                    Tentar de novo
                  </Button>
                </AlertDescription>
              </Alert>
            ) : !result ? (
              <Grid view={view}>
                {Array.from({ length: 8 }, (_, i) => (
                  <CardSkeleton key={i} view={view} />
                ))}
              </Grid>
            ) : hits.length === 0 ? (
              source === 'workshop' ? (
                <NoWorkshopParts query={text} stockOnly={state.avail === 'stock'} onCatalog={() => setAvail('all')} />
              ) : (
                <NoResults query={text} {...(state.vehicle ? { vehicle: state.vehicle.label } : {})} filtered={filters.length > 0} onClear={clearFilters} onExample={submit} />
              )
            ) : (
              <>
                <div className={cn('transition-opacity', search.isFetching && 'opacity-60')} aria-busy={search.isFetching}>
                  <Grid view={view}>
                    {hits.map((h, i) => {
                      const local = stock.data?.get(h.sku);
                      return (
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
                          onBrand={h.brand && catalog ? () => patch({ brands: toggle(state.brands, h.brand!.key) }) : undefined}
                          {...(local ? { stock: local } : {})}
                          stockLoading={stockLoading}
                        />
                      );
                    })}
                  </Grid>
                </div>
                {result.truncated && (
                  <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                    <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" />
                    Mostrando as {RANK_WINDOW} mais relevantes de {result.total.toLocaleString('pt-BR')}. Para chegar às outras, refine com marca, categoria, veículo ou um código.
                  </p>
                )}
                <Pagination page={result.page} pages={result.totalPages} onPage={goPage} />
              </>
            )}
          </section>
        </div>
      )}

      <CompareBar hits={compare} onCompare={() => setDialog('compare')} onClear={() => setCompare([])} />

      <PartSheet
        sku={state.sku}
        hit={sheetHit}
        {...(state.vehicle ? { vehicle: state.vehicle } : {})}
        onClose={closePart}
        onSearchCode={(code) => {
          searchCode(code);
          inputRef.current?.focus();
        }}
        onVehicle={pickApplication}
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
            <Button variant="outline" className="flex-1" onClick={clearFilters} disabled={filters.length === 0}>
              Limpar
            </Button>
            <Button className="flex-1" onClick={() => setDialog(null)}>
              Ver {result ? result.total.toLocaleString('pt-BR') : ''} peças
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ShortcutsDialog open={dialog === 'shortcuts'} onOpenChange={(o) => !o && setDialog(null)} />
    </div>
  );
}

/** Lista: linhas densas num único painel, com cabeçalho de colunas. Grade: cards com foto. */
function Grid({ view, children }: { view: CardView; children: React.ReactNode }) {
  if (view === 'grid') return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      <div aria-hidden className="hidden grid-cols-[3rem_minmax(0,1fr)_11rem_9rem_2rem] gap-x-4 bg-muted/50 px-3 py-1.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase md:grid">
        <span />
        <span>Peça</span>
        <span>Categoria</span>
        <span>Na oficina</span>
        <span />
      </div>
      {children}
    </div>
  );
}
