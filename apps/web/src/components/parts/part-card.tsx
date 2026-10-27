'use client';

import { Check, Copy, GitCompareArrows, Globe2, MapPin } from 'lucide-react';
import { PartImage } from '@/components/catalog/part-image';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { formatLocation, highlight, type PartHit, type WorkshopStock } from '@/lib/part-search';
import { StockCell } from './stock-cell';

export type CardView = 'grid' | 'list';

export function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded-sm bg-brand/15 px-px text-inherit">
            {s.text}
          </mark>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

/** Copia para a área de transferência e avisa. */
export function useCopy() {
  const { toast } = useToast();
  return async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copiado`, description: text, tone: 'success', duration: 2000 });
    } catch {
      toast({ title: 'Não foi possível copiar', tone: 'error' });
    }
  };
}

/**
 * Card de uma peça. A área principal é um único botão que abre a ficha (um alvo só para teclado e leitor de tela); copiar o número e marcar para
 * comparar são botões irmãos, fora dele, porque botão dentro de botão não é HTML válido.
 */
export function PartCard({
  hit,
  query,
  view,
  selected,
  comparing,
  compareDisabled,
  onOpen,
  onToggleCompare,
  onBrand,
  index,
  stock,
  stockLoading,
}: {
  hit: PartHit;
  query: string;
  view: CardView;
  /** Destaque do teclado (j/k). */
  selected: boolean;
  comparing: boolean;
  compareDisabled: boolean;
  onOpen: () => void;
  onToggleCompare: () => void;
  onBrand?: () => void;
  index: number;
  /** Saldo e preço de venda da oficina; sem isso a peça ainda não foi cadastrada. */
  stock?: WorkshopStock;
  stockLoading?: boolean;
}) {
  const copy = useCopy();
  const list = view === 'list';
  const workshop = hit.workshop ?? stock;
  // Oferta da plataforma só aparece quando a oficina não tem a peça cadastrada (o Fixer não publica ofertas, então é raro).
  const loc = hit.offer ? formatLocation(hit.offer.locations) : null;

  const brand = hit.brand && (
    <button
      type="button"
      onClick={onBrand}
      title={`Filtrar por ${hit.brand.name}`}
      className="relative z-20 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand hover:bg-brand/20"
    >
      {hit.brand.name}
    </button>
  );
  const universal = hit.isUniversalFit && (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
      <Globe2 aria-hidden className="size-3" /> Universal
    </span>
  );
  const code = (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="tabular truncate">
        <Marked text={hit.partNumber} query={query} />
      </span>
      <button
        type="button"
        onClick={() => copy(hit.partNumber, 'Código')}
        aria-label={`Copiar código ${hit.partNumber}`}
        className="relative z-20 grid size-5 shrink-0 place-items-center rounded text-muted-foreground/70 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
      >
        <Copy aria-hidden className="size-3" />
      </button>
    </span>
  );
  const stockCell = <StockCell sku={hit.sku} name={hit.name} {...(workshop ? { stock: workshop } : {})} loading={stockLoading ?? false} align={list ? 'start' : 'end'} />;
  const compareButton = (
    <button
      type="button"
      onClick={onToggleCompare}
      aria-pressed={comparing}
      disabled={compareDisabled && !comparing}
      aria-label={comparing ? `Tirar ${hit.name} da comparação` : `Comparar ${hit.name}`}
      title={compareDisabled && !comparing ? 'Máximo de 4 peças' : comparing ? 'Tirar da comparação' : 'Comparar'}
      className={cn(
        'z-20 grid size-8 place-items-center rounded-lg border bg-card/95 shadow-xs backdrop-blur transition',
        list ? 'relative shrink-0' : 'absolute top-5 right-5',
        comparing ? 'border-brand bg-brand text-primary-foreground' : 'text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-brand focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-0',
      )}
    >
      {comparing ? <Check aria-hidden className="size-4" /> : <GitCompareArrows aria-hidden className="size-4" />}
    </button>
  );
  const open = <button type="button" onClick={onOpen} aria-label={`Abrir ${hit.name}, código ${hit.partNumber}`} className="absolute inset-0 z-10 rounded-xl focus-visible:outline-offset-0" />;

  // Linha densa de balcão: a pessoa varre nome, código, categoria e saldo sem rolar.
  if (list) {
    return (
      <article
        data-hit={hit.sku}
        aria-posinset={index + 1}
        className={cn(
          'group relative grid items-center gap-x-4 gap-y-1 px-3 py-2 transition-colors',
          'grid-cols-[3rem_minmax(0,1fr)_auto_2rem] md:grid-cols-[3rem_minmax(0,1fr)_11rem_9rem_2rem]',
          'hover:bg-accent/50 focus-within:bg-accent/50',
          selected && 'bg-accent ring-2 ring-inset ring-ring/40',
        )}
      >
        {open}
        <PartImage key={hit.imageUrl} url={hit.imageUrl} className="size-12 rounded-lg bg-white" />
        <div className="min-w-0 space-y-0.5">
          <h3 className="line-clamp-1 text-sm leading-snug font-semibold">
            <Marked text={hit.name} query={query} />
          </h3>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {code}
            {brand}
            {universal}
          </div>
        </div>
        <p className="hidden min-w-0 truncate text-xs text-muted-foreground md:block">{hit.category?.name ?? '—'}</p>
        <div className="min-w-0">
          {stockCell}
          {loc && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin aria-hidden className="size-3 shrink-0" /> <span className="truncate">{loc}</span>
            </p>
          )}
        </div>
        {compareButton}
      </article>
    );
  }

  return (
    <article
      data-hit={hit.sku}
      aria-posinset={index + 1}
      className={cn(
        'surface group relative flex flex-col gap-3 rounded-2xl border bg-card p-3 transition-[transform,box-shadow,border-color] duration-200',
        'hover:-translate-y-0.5 hover:border-ring/40 focus-within:border-ring/60',
        selected && 'border-ring ring-[3px] ring-ring/20',
      )}
    >
      {open}
      <PartImage key={hit.imageUrl} url={hit.imageUrl} className="aspect-[4/3] w-full rounded-xl bg-white" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {brand}
            {universal}
          </div>
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm leading-snug font-semibold">
            <Marked text={hit.name} query={query} />
          </h3>
          <div className="flex min-w-0 items-center gap-1.5">
            {code}
            {hit.category && <span className="truncate text-xs text-muted-foreground before:mr-1.5 before:content-['·']">{hit.category.name}</span>}
          </div>
        </div>
        <div className="flex items-end justify-between gap-2">
          {stockCell}
          {loc && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin aria-hidden className="size-3" /> {loc}
            </p>
          )}
        </div>
      </div>
      {compareButton}
    </article>
  );
}

export function CardSkeleton({ view }: { view: CardView }) {
  if (view === 'list') {
    return (
      <div aria-hidden className="flex items-center gap-4 px-3 py-2">
        <div className="skeleton size-12 rounded-lg" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-3/5 rounded" />
          <div className="skeleton h-3 w-2/5 rounded" />
        </div>
        <div className="skeleton h-8 w-24 rounded" />
      </div>
    );
  }
  return (
    <div aria-hidden className="flex flex-col gap-3 rounded-2xl border bg-card p-3">
      <div className="skeleton aspect-[4/3] w-full rounded-xl" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-4 w-16 rounded-full" />
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-3 w-2/5 rounded" />
        <div className="skeleton mt-3 h-5 w-24 rounded" />
      </div>
    </div>
  );
}
