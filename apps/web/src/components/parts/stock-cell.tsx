'use client';

import { Loader2, PackagePlus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, type WorkshopStock } from '@/lib/part-search';
import { cn } from '@/lib/utils';
import { useRegisterPart } from './use-parts';

const qty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * O que a oficina tem da peça: saldo e preço de venda, ou o convite para cadastrar. Os estados nunca dependem só da cor: o saldo sempre vem escrito.
 * `loading` é o estoque ainda a caminho (a busca do catálogo chega antes).
 */
export function StockCell({ sku, name, stock, loading, align = 'start' }: { sku: string; name: string; stock?: WorkshopStock; loading?: boolean; align?: 'start' | 'end' }) {
  if (loading && !stock) return <Skeleton aria-hidden className="h-8 w-28 rounded-md" />;
  if (!stock) {
    return (
      <div className={cn('flex flex-col gap-1', align === 'end' && 'items-end')}>
        <span className="text-xs text-muted-foreground">Não cadastrada</span>
        <QuickAdd sku={sku} name={name} />
      </div>
    );
  }
  const out = stock.stockQty <= 0;
  return (
    <div className={cn('flex flex-col leading-tight', align === 'end' && 'items-end')}>
      <span className="tabular text-sm font-semibold">{formatMoney(stock.sellPrice)}</span>
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', out ? 'text-destructive' : 'text-emerald-700')}>
        <span aria-hidden className={cn('size-1.5 rounded-full', out ? 'bg-destructive' : 'bg-emerald-600')} />
        {out ? 'Sem saldo' : `${qty(stock.stockQty)} em estoque`}
      </span>
    </div>
  );
}

/** Cadastro rápido direto da lista: custo e venda, o resto vem do catálogo. A ficha da peça continua tendo o formulário completo. */
function QuickAdd({ sku, name }: { sku: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState('');
  const [sell, setSell] = useState('');
  const create = useRegisterPart(sku, name, () => setOpen(false));
  const toNum = (s: string) => Number(s.replace(',', '.'));
  const valid = [cost, sell].every((v) => v.trim() !== '' && toNum(v) >= 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Cadastrar ${name} na oficina`} className="relative z-20 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-brand hover:border-ring/50 hover:bg-accent">
          <PackagePlus aria-hidden className="size-3.5" /> Cadastrar
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate({ costPrice: toNum(cost), sellPrice: toNum(sell) });
          }}
        >
          <div>
            <p className="line-clamp-2 text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">Nome e código de barras vêm do catálogo.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['Custo (R$)', cost, setCost],
                ['Venda (R$)', sell, setSell],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="space-y-1 text-xs font-medium">
                {label}
                <input
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder="0,00"
                  className="tabular h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
                />
              </label>
            ))}
          </div>
          <Button type="submit" size="sm" className="w-full" disabled={!valid || create.isPending}>
            {create.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <PackagePlus aria-hidden />} Cadastrar na oficina
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
