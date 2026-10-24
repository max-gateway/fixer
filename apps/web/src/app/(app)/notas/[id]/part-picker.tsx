'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Library, Package, RefreshCw, SearchX } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { PickerTrigger } from '@/components/picker/picker-trigger';
import { PickerNotice, PickerRow, PickerSkeleton, SearchDialog } from '@/components/picker/search-dialog';
import { CommandEmpty, CommandGroup } from '@/components/ui/command';
import { getJson } from '@/lib/client-api';
import type { Part } from '@/lib/orders';

type Picked = Pick<Part, 'id' | 'sku' | 'name'>;

const stock = (p: Part) => `${p.sku} · estoque ${Number(p.stockQty).toLocaleString('pt-BR')}`;
const tile = (size: string) => (
  <span aria-hidden className={`grid ${size} shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground [&>svg]:size-1/2`}>
    <Package />
  </span>
);

/**
 * Busca de peça do estoque por nome ou SKU (no servidor, com debounce), na mesma janela do seletor do catálogo (ver `SearchDialog`): setas e Enter
 * escolhem, e a busca começa com o texto da nota (`initialQuery`). Selecionar a peça marcada de novo a limpa.
 */
export function PartPicker({
  id,
  value,
  onChange,
  initialQuery = '',
  onSearchCatalog,
}: {
  id: string;
  value: Picked | null;
  onChange: (part: Picked | null) => void;
  /** Texto para já começar a busca (ex.: descrição do item da nota). */
  initialQuery?: string;
  /** Se informado, a lista vazia oferece buscar no catálogo (a peça pode existir lá sem ter sido cadastrada na oficina). */
  onSearchCatalog?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [active, setActive] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['parts-search', debounced],
    enabled: open,
    placeholderData: keepPreviousData,
    queryFn: () => getJson<Part[]>(`/api/parts?search=${encodeURIComponent(debounced)}`, 'Não foi possível buscar as peças.'),
    staleTime: 10_000,
  });

  const parts = data ?? [];
  const current = parts.find((p) => p.id.toLowerCase() === active.toLowerCase()) ?? parts[0];
  const busy = open && (isFetching || text.trim() !== debounced);

  function choose(p: Part) {
    onChange(value?.id === p.id ? null : { id: p.id, sku: p.sku, name: p.name });
    setOpen(false);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <PickerTrigger
        id={id}
        placeholder="Buscar peça da oficina por nome ou SKU"
        label={value ? `${value.sku} · ${value.name}` : null}
        lead={tile('size-10')}
        icon={<Package />}
        clearLabel="Limpar peça do estoque"
        onClear={() => onChange(null)}
      />
      <SearchDialog
        open={open}
        title="Buscar peça cadastrada na oficina"
        description="Digite o nome ou o SKU e escolha a peça na lista."
        placeholder="Nome ou SKU"
        text={text}
        onText={setText}
        inputRef={inputRef}
        busy={busy}
        focusedValue={current?.id ?? ''}
        onFocusedValue={setActive}
        resultCount={parts.length}
      >
        {error && (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-destructive">{error.message}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <RefreshCw aria-hidden className="size-3.5" /> Tentar de novo
            </button>
          </div>
        )}
        {!error && !data && <PickerSkeleton />}
        {!error && data && parts.length === 0 && !busy && (
          <CommandEmpty className="p-0">
            <PickerNotice icon={<SearchX />}>
              <span className="block">Nenhuma peça cadastrada na oficina{debounced ? <> com “{debounced}”</> : null}.</span>
              {onSearchCatalog && (
                <>
                  <span className="mt-1 block text-xs">Ela pode estar no catálogo sem ter sido cadastrada aqui ainda.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSearchCatalog();
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <Library aria-hidden className="size-3.5" /> Buscar no catálogo
                  </button>
                </>
              )}
            </PickerNotice>
          </CommandEmpty>
        )}
        {!error && parts.length > 0 && (
          <CommandGroup className="p-0">
            {parts.map((p, i) => (
              <PickerRow
                key={p.id}
                value={p.id}
                index={i}
                focused={current?.id === p.id}
                chosen={value?.id === p.id}
                lead={tile('size-12')}
                title={p.name}
                subtitle={stock(p)}
                onChoose={() => choose(p)}
              />
            ))}
          </CommandGroup>
        )}
      </SearchDialog>
    </DialogPrimitive.Root>
  );
}
