'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Part } from '@/lib/orders';
import { cn } from '@/lib/utils';

type Picked = Pick<Part, 'id' | 'sku' | 'name'>;

/**
 * Busca de peça por nome ou SKU (no servidor, com debounce). É um combobox: o botão mostra a peça escolhida, abre uma lista
 * pesquisável com setas e Enter, e a busca começa com o texto da nota (`initialQuery`). Selecionar a peça marcada de novo a limpa.
 */
export function PartPicker({
  id,
  value,
  onChange,
  initialQuery = '',
}: {
  id: string;
  value: Picked | null;
  onChange: (part: Picked | null) => void;
  /** Texto para já começar a busca (ex.: descrição do item da nota). */
  initialQuery?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['parts-search', debounced],
    enabled: open,
    queryFn: async ({ signal }): Promise<Part[]> => {
      const res = await fetch(`/api/parts?search=${encodeURIComponent(debounced)}`, { cache: 'no-store', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 10_000,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn('min-w-0 truncate', !value && 'text-muted-foreground')}>{value ? `${value.sku} · ${value.name}` : 'Buscar peça por nome ou SKU'}</span>
          <ChevronsUpDown aria-hidden className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        {/* A busca é do servidor: o cmdk não filtra de novo (shouldFilter=false). */}
        <Command shouldFilter={false}>
          <CommandInput value={text} onValueChange={setText} placeholder="Nome ou SKU" />
          <CommandList>
            {isError && <p className="px-3 py-6 text-center text-sm text-destructive">Não foi possível buscar as peças.</p>}
            {!isError && isFetching && !data && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Buscando…</p>}
            {!isError && !isFetching && data?.length === 0 && <CommandEmpty>Nenhuma peça encontrada.</CommandEmpty>}
            <CommandGroup>
              {data?.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onChange(value?.id === p.id ? null : { id: p.id, sku: p.sku, name: p.name });
                    setOpen(false);
                  }}
                  className="justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.sku} · estoque {Number(p.stockQty).toLocaleString('pt-BR')}
                    </span>
                  </span>
                  {value?.id === p.id && <Check aria-hidden className="size-4 shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
