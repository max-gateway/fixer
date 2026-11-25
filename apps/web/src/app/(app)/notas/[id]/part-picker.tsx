'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Part } from '@/lib/orders';
import { cn } from '@/lib/utils';

/** Busca de peça por nome ou SKU (com debounce). Selecionar devolve a peça; limpar o texto remove a seleção. */
export function PartPicker({
  id,
  value,
  onChange,
  initialQuery = '',
}: {
  id: string;
  value: Pick<Part, 'id' | 'sku' | 'name'> | null;
  onChange: (part: Pick<Part, 'id' | 'sku' | 'name'> | null) => void;
  /** Texto para já começar a busca (ex.: descrição do item da nota). */
  initialQuery?: string;
}) {
  const [text, setText] = useState(value ? `${value.sku} · ${value.name}` : '');
  const [debounced, setDebounced] = useState(initialQuery);
  const [open, setOpen] = useState(false);

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
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        placeholder="Buscar peça por nome ou SKU"
        className="pl-9"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null); // editar o texto invalida a seleção anterior
        }}
      />
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {isError && <li className="px-3 py-2 text-destructive">Não foi possível buscar as peças.</li>}
          {!isError && data?.length === 0 && !isFetching && <li className="px-3 py-2 text-muted-foreground">Nenhuma peça encontrada.</li>}
          {data?.map((p) => (
            <li key={p.id} role="option" aria-selected={value?.id === p.id}>
              <button
                type="button"
                // onMouseDown: dispara antes do blur do input fechar a lista.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange({ id: p.id, sku: p.sku, name: p.name });
                  setText(`${p.sku} · ${p.name}`);
                  setOpen(false);
                }}
                className={cn('flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left hover:bg-accent', value?.id === p.id && 'bg-accent')}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.sku} · estoque {Number(p.stockQty).toLocaleString('pt-BR')}
                  </span>
                </span>
                {value?.id === p.id && <Check aria-hidden className="size-4 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
