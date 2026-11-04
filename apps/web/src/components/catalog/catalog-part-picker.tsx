'use client';

import { Library, RefreshCw, Search, SearchX } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef, useState } from 'react';
import { PickerTrigger } from '@/components/picker/picker-trigger';
import { PickerNotice, PickerRow, PickerSkeleton, SearchDialog } from '@/components/picker/search-dialog';
import { CommandEmpty, CommandGroup } from '@/components/ui/command';
import { hitLabel, hitSubtitle, type CatalogHit } from '@/lib/catalog';
import { HitPreview } from './hit-preview';
import { PartImage } from './part-image';
import { MIN_CHARS, useCatalogSearch, usePrefetchCatalogSearch } from './use-catalog-search';

/**
 * Busca de peça no catálogo global da plataforma (por nome, número ou código de barras; no servidor, com debounce). Abre numa janela com o fundo
 * desfocado: lista à esquerda e a foto da peça em foco à direita (ver `SearchDialog`). As peças vêm do catálogo, não do estoque da oficina:
 * escolher uma aqui NÃO a coloca no estoque, só a indica (quem chama decide o que fazer com ela). Escolher de novo a peça marcada a limpa.
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
  const [active, setActive] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const prefetch = usePrefetchCatalogSearch(initialQuery);
  const { query, ready, hits, busy } = useCatalogSearch(text, open);

  // A peça em foco é a que o cmdk marcou; enquanto ele não marcou nenhuma (lista nova), vale a primeira.
  const current = hits.find((h) => h.sku.toLowerCase() === active.toLowerCase()) ?? hits[0];

  function choose(hit: CatalogHit) {
    onChange(value?.sku === hit.sku ? null : hit);
    setOpen(false);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <PickerTrigger
        id={id}
        placeholder="Buscar no catálogo por nome, código ou GTIN"
        label={value ? hitLabel(value) : null}
        lead={value && <PartImage key={value.sku} url={value.imageUrl} className="size-10 rounded-md bg-white" />}
        icon={<Library />}
        clearLabel="Limpar peça do catálogo"
        onClear={() => onChange(null)}
        onWarm={prefetch}
      />
      <SearchDialog
        open={open}
        title="Buscar peça no catálogo"
        description="Digite o nome, o número ou o código de barras e escolha a peça na lista."
        placeholder="Nome ou código da peça"
        text={text}
        onText={setText}
        inputRef={inputRef}
        busy={busy}
        focusedValue={current?.sku ?? ''}
        onFocusedValue={setActive}
        resultCount={hits.length}
        preview={<HitPreview hit={current} />}
      >
        {!ready && <PickerNotice icon={<Search />}>Digite pelo menos {MIN_CHARS} letras para buscar.</PickerNotice>}
        {ready && query.error && (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-destructive">{query.error.message}</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <RefreshCw aria-hidden className="size-3.5" /> Tentar de novo
            </button>
          </div>
        )}
        {ready && !query.error && !query.data && <PickerSkeleton />}
        {ready && !query.error && query.data && hits.length === 0 && !busy && (
          <CommandEmpty className="p-0">
            <PickerNotice icon={<SearchX />}>Nenhuma peça encontrada no catálogo.</PickerNotice>
          </CommandEmpty>
        )}
        {ready && !query.error && hits.length > 0 && (
          <CommandGroup className="p-0">
            {hits.map((hit, i) => (
              <PickerRow
                key={hit.sku}
                value={hit.sku}
                index={i}
                focused={current?.sku === hit.sku}
                chosen={value?.sku === hit.sku}
                lead={<PartImage url={hit.imageUrl} className="size-12 rounded-md bg-white" />}
                title={hit.name}
                subtitle={hitSubtitle(hit)}
                onChoose={() => choose(hit)}
              />
            ))}
          </CommandGroup>
        )}
      </SearchDialog>
    </DialogPrimitive.Root>
  );
}
