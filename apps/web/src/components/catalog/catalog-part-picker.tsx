'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getJson } from '@/lib/client-api';
import { hitLabel, hitSubtitle, type CatalogHit, type CatalogSearch } from '@/lib/catalog';
import { cn } from '@/lib/utils';

/** A busca do catálogo só faz sentido com texto suficiente para filtrar; abaixo disso a plataforma devolveria o catálogo inteiro. */
const MIN_CHARS = 2;

/**
 * Busca de peça no catálogo global da plataforma (por nome, número ou código de barras; no servidor, com debounce). Mesmo desenho do `PartPicker`,
 * mas as peças vêm do catálogo, não do estoque da oficina: escolher uma peça aqui NÃO a coloca no estoque, só a indica (quem chama decide o que fazer
 * com ela: cadastrar a peça da oficina ou vincular uma que já existe). Selecionar a peça marcada de novo a limpa.
 */
export function CatalogPartPicker({
  id,
  value,
  onChange,
  initialQuery = '',
}: {
  id: string;
  value: CatalogHit | null;
  onChange: (hit: CatalogHit | null) => void;
  /** Texto para já começar a busca (ex.: descrição do item da nota). */
  initialQuery?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery.trim());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const enabled = open && debounced.length >= MIN_CHARS;
  const { data, isFetching, error } = useQuery({
    queryKey: ['catalog-search', debounced],
    enabled,
    // A API já repete o que é transitório e responde com uma mensagem pronta; repetir aqui só atrasaria o aviso.
    retry: false,
    staleTime: 10_000,
    queryFn: () => getJson<CatalogSearch>(`/api/catalog/parts/search?q=${encodeURIComponent(debounced)}&limit=10`, 'Não foi possível buscar no catálogo.'),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn('min-w-0 truncate', !value && 'text-muted-foreground')}>{value ? hitLabel(value) : 'Buscar no catálogo por nome, código ou GTIN'}</span>
          <ChevronsUpDown aria-hidden className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        {/* A busca é do servidor: o cmdk não filtra de novo (shouldFilter=false). */}
        <Command shouldFilter={false}>
          <CommandInput value={text} onValueChange={setText} placeholder="Nome ou código da peça" />
          <CommandList>
            {debounced.length < MIN_CHARS && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Digite pelo menos {MIN_CHARS} letras para buscar.</p>}
            {enabled && error && (
              <p role="alert" className="px-3 py-6 text-center text-sm text-destructive">
                {error.message}
              </p>
            )}
            {enabled && !error && isFetching && !data && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Buscando…</p>}
            {enabled && !error && !isFetching && data?.data.length === 0 && <CommandEmpty>Nenhuma peça encontrada no catálogo.</CommandEmpty>}
            <CommandGroup>
              {enabled &&
                !error &&
                data?.data.map((hit) => (
                  <CommandItem
                    key={hit.sku}
                    value={hit.sku}
                    onSelect={() => {
                      onChange(value?.sku === hit.sku ? null : hit);
                      setOpen(false);
                    }}
                    className="justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{hit.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{hitSubtitle(hit)}</span>
                    </span>
                    {value?.sku === hit.sku && <Check aria-hidden className="size-4 shrink-0" />}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
