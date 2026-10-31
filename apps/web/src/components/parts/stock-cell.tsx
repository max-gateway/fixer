'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, type WorkshopStock } from '@/lib/part-search';
import { cn } from '@/lib/utils';

const qty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * O que a oficina tem da peça: saldo e preço de venda. Toda peça do catálogo já é cadastro; a oficina que nunca a comprou simplesmente não tem
 * estoque (a peça local nasce sozinha quando entra pela nota). Os estados nunca dependem só da cor: o saldo sempre vem escrito.
 * `loading` é o estoque ainda a caminho (a busca do catálogo chega antes).
 */
export function StockCell({ stock, loading, align = 'start' }: { stock?: WorkshopStock; loading?: boolean; align?: 'start' | 'end' }) {
  if (loading && !stock) return <Skeleton aria-hidden className="h-8 w-28 rounded-md" />;
  if (!stock) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', align === 'end' && 'justify-end')}>
        <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />
        Sem estoque
      </span>
    );
  }
  const out = stock.stockQty <= 0;
  return (
    <div className={cn('flex flex-col leading-tight', align === 'end' && 'items-end')}>
      <span className="tabular text-sm font-semibold">{formatMoney(stock.sellPrice)}</span>
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', out ? 'text-destructive' : 'text-emerald-700')}>
        <span aria-hidden className={cn('size-1.5 rounded-full', out ? 'bg-destructive' : 'bg-emerald-600')} />
        {out ? 'Sem estoque' : `${qty(stock.stockQty)} em estoque`}
      </span>
    </div>
  );
}
