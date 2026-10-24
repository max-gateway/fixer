'use client';

import { Check, Copy, GitCompareArrows, Globe2, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { PartImage } from '@/components/catalog/part-image';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { formatCents, formatLocation, highlight, type PartHit } from '@/lib/part-search';

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

function Stock({ offer }: { offer: NonNullable<PartHit['offer']> }) {
  const out = offer.quantityAvailable <= 0;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', out ? 'text-red-700' : 'text-emerald-700')}>
      <span aria-hidden className={cn('size-1.5 rounded-full', out ? 'bg-red-500' : 'bg-emerald-500')} />
      {out ? 'Sem saldo' : `${offer.quantityAvailable} em estoque`}
    </span>
  );
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
}) {
  const copy = useCopy();
  const offer = hit.offer;
  const price: ReactNode =
    offer?.priceCents != null ? (
      <span className="tabular text-lg font-semibold tracking-tight">{formatCents(offer.priceCents)}</span>
    ) : (
      <span className="text-xs text-muted-foreground">{offer ? 'Sem preço' : 'Sem oferta na loja'}</span>
    );
  const loc = offer ? formatLocation(offer.location) : null;
  const list = view === 'list';

  return (
    <article
      data-hit={hit.sku}
      aria-posinset={index + 1}
      className={cn(
        'surface group relative flex rounded-2xl border bg-card transition-[transform,box-shadow,border-color] duration-200',
        'hover:-translate-y-0.5 hover:border-ring/40 focus-within:border-ring/60',
        selected && 'border-ring ring-[3px] ring-ring/20',
        list ? 'items-center gap-4 p-3' : 'flex-col gap-3 p-3',
      )}
    >
      <button type="button" onClick={onOpen} aria-label={`Abrir ${hit.name}, código ${hit.partNumber}`} className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-offset-0" />
      <PartImage key={hit.imageUrl} url={hit.imageUrl} className={cn('rounded-xl bg-white', list ? 'size-20' : 'aspect-[4/3] w-full')} />
      <div className={cn('flex min-w-0 flex-1 flex-col gap-2', list && 'sm:flex-row sm:items-center sm:gap-6')}>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {hit.brand && (
              <button
                type="button"
                onClick={onBrand}
                title={`Filtrar por ${hit.brand.name}`}
                className="relative z-20 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand hover:bg-brand/20"
              >
                {hit.brand.name}
              </button>
            )}
            {hit.isUniversalFit && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                <Globe2 aria-hidden className="size-3" /> Universal
              </span>
            )}
          </div>
          <h3 className={cn('leading-snug font-semibold', list ? 'line-clamp-1 text-sm' : 'line-clamp-2 min-h-[2.5rem] text-sm')}>
            <Marked text={hit.name} query={query} />
          </h3>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="tabular truncate">
              <Marked text={hit.partNumber} query={query} />
            </span>
            <button
              type="button"
              onClick={() => copy(hit.partNumber, 'Código')}
              aria-label={`Copiar código ${hit.partNumber}`}
              className="relative z-20 grid size-5 place-items-center rounded text-muted-foreground/70 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
            >
              <Copy aria-hidden className="size-3" />
            </button>
            {hit.category && <span className="truncate before:mr-1.5 before:content-['·']">{hit.category.name}</span>}
          </p>
        </div>
        <div className={cn('flex items-end justify-between gap-2', list && 'sm:w-44 sm:flex-col sm:items-end sm:justify-center sm:gap-1')}>
          <div className={cn('space-y-0.5', list && 'sm:text-right')}>
            {price}
            {offer && <div><Stock offer={offer} /></div>}
            {loc && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground sm:justify-end">
                <MapPin aria-hidden className="size-3" /> {loc}
              </p>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleCompare}
        aria-pressed={comparing}
        disabled={compareDisabled && !comparing}
        aria-label={comparing ? `Tirar ${hit.name} da comparação` : `Comparar ${hit.name}`}
        title={compareDisabled && !comparing ? 'Máximo de 4 peças' : comparing ? 'Tirar da comparação' : 'Comparar'}
        className={cn(
          'absolute top-5 right-5 z-20 grid size-8 place-items-center rounded-lg border bg-card/95 shadow-xs backdrop-blur transition',
          list && 'top-1/2 right-3 -translate-y-1/2 sm:right-4',
          comparing ? 'border-brand bg-brand text-primary-foreground' : 'text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-brand focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-0',
        )}
      >
        {comparing ? <Check aria-hidden className="size-4" /> : <GitCompareArrows aria-hidden className="size-4" />}
      </button>
    </article>
  );
}

export function CardSkeleton({ view }: { view: CardView }) {
  const list = view === 'list';
  return (
    <div aria-hidden className={cn('flex rounded-2xl border bg-card p-3', list ? 'items-center gap-4' : 'flex-col gap-3')}>
      <div className={cn('skeleton rounded-xl', list ? 'size-20' : 'aspect-[4/3] w-full')} />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-4 w-16 rounded-full" />
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-3 w-2/5 rounded" />
        <div className="skeleton mt-3 h-5 w-24 rounded" />
      </div>
    </div>
  );
}
