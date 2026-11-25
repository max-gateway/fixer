'use client';

import { ArrowUpLeft, Clock, CornerDownLeft, Loader2, ScanBarcode, Search, Tag, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Kbd } from '@/components/nav/kbd';
import { cn } from '@/lib/utils';
import { highlight, KIND_LABEL, queryKind, type Suggestion } from '@/lib/part-search';
import { BarcodeScanner, canScanBarcodes } from './barcode-scanner';
import { useSuggestions } from './use-parts';

type Row = { id: string; kind: 'suggestion' | 'recent'; text: string; suggestion?: Suggestion };

/**
 * Campo de busca principal: o que a pessoa digita já filtra a lista (quem controla o debounce é a página), o autocomplete sugere peças com o
 * número e as aplicações, e sem texto mostra as buscas recentes. Padrão combobox (ARIA): as setas movem a seleção sem tirar o foco do campo.
 */
export function SearchBar({
  value,
  onChange,
  onSubmit,
  onPick,
  recents,
  onClearRecents,
  busy,
  inputRef,
  autoFocus,
  vehicleId,
  placeholder = 'Busque por nome, código, marca + código ou código de barras',
}: {
  value: string;
  onChange: (value: string) => void;
  /** Enter ou escolha de uma busca recente: confirma o texto (grava nas recentes). */
  onSubmit: (value: string) => void;
  /** Escolha de uma sugestão do autocomplete: busca pelo número e abre a peça. */
  onPick: (s: Suggestion) => void;
  recents: string[];
  onClearRecents: () => void;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  /** Veículo escolhido: as sugestões dizem se a peça serve nele. */
  vehicleId?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => setCanScan(canScanBarcodes()), []);

  const text = value.trim();
  const suggest = useSuggestions(value, open && text.length >= 2, vehicleId);
  const rows: Row[] = useMemo(() => {
    if (text.length < 2) return recents.map((r) => ({ id: `r:${r}`, kind: 'recent', text: r }));
    return (suggest.data?.data ?? []).map((s) => ({ id: `s:${s.sku}`, kind: 'suggestion', text: s.label, suggestion: s }));
  }, [text, recents, suggest.data]);
  useEffect(() => setActive(-1), [rows.length, text]);

  // Clique fora fecha.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const kind = queryKind(value);
  const pick = (row: Row) => {
    setOpen(false);
    if (row.kind === 'recent') {
      onChange(row.text);
      onSubmit(row.text);
    } else onPick(row.suggestion!);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (rows.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step < 0 ? rows.length - 1 : (i + step) % rows.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (open && row) pick(row);
      else {
        setOpen(false);
        onSubmit(value);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (value) {
        e.preventDefault();
        onChange('');
      }
    }
  }

  const showList = open && (rows.length > 0 || (text.length >= 2 && suggest.isFetching));
  return (
    <div ref={wrap} className="relative">
      <div
        className={cn(
          'surface group flex h-14 items-center gap-3 rounded-2xl border bg-card px-4 transition-shadow',
          'focus-within:border-ring focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--brand-primary)_16%,transparent)]',
        )}
      >
        {busy ? <Loader2 aria-hidden className="size-5 shrink-0 animate-spin text-brand" /> : <Search aria-hidden className="size-5 shrink-0 text-muted-foreground group-focus-within:text-brand" />}
        <input
          ref={inputRef}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && rows[active] ? `${listId}-${active}` : undefined}
          aria-label="Buscar peças"
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 focus-visible:outline-none"
        />
        {kind !== 'empty' && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand sm:inline-flex">
            {kind === 'gtin' ? <ScanBarcode aria-hidden className="size-3.5" /> : <Tag aria-hidden className="size-3.5" />}
            {KIND_LABEL[kind]}
          </span>
        )}
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            aria-label="Limpar busca"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
        {canScan && (
          <button
            type="button"
            onClick={() => setScanning(true)}
            aria-label="Ler código de barras com a câmera"
            title="Ler código de barras"
            className="grid size-9 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground hover:border-ring/50 hover:text-brand"
          >
            <ScanBarcode aria-hidden className="size-4.5" />
          </button>
        )}
        {!value && (
          <Kbd aria-hidden className="hidden shrink-0 text-muted-foreground sm:inline-flex">
            /
          </Kbd>
        )}
      </div>

      {showList && (
        <div className="surface animate-rise absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border bg-popover">
          {text.length < 2 && (
            <div className="flex items-center justify-between px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
              <span>Buscas recentes</span>
              <button type="button" onClick={onClearRecents} className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground">
                Limpar
              </button>
            </div>
          )}
          <ul id={listId} role="listbox" aria-label={text.length < 2 ? 'Buscas recentes' : 'Sugestões'} className="max-h-[22rem] overflow-y-auto p-1.5">
            {rows.map((row, i) => (
              <li
                key={row.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(row)}
                className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2', i === active ? 'bg-accent' : 'hover:bg-accent/60')}
              >
                {row.kind === 'recent' ? (
                  <>
                    <Clock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{row.text}</span>
                    <ArrowUpLeft aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
                  </>
                ) : (
                  <>
                    <Tag aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {highlight(row.suggestion!.label, value).map((seg, k) => (seg.hit ? <mark key={k} className="rounded-sm bg-brand/15 text-inherit">{seg.text}</mark> : seg.text))}
                      </span>
                      <span className="tabular block truncate text-xs text-muted-foreground">
                        {[row.suggestion!.partNumber, row.suggestion!.brand, row.suggestion!.applicationsSummary?.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {vehicleId && row.suggestion!.compatibleWithVehicle !== undefined && (
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', row.suggestion!.compatibleWithVehicle ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground')}>
                        {row.suggestion!.compatibleWithVehicle ? 'Serve' : 'Não serve'}
                      </span>
                    )}
                    {i === active && <CornerDownLeft aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                  </>
                )}
              </li>
            ))}
            {rows.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Buscando sugestões…</li>}
          </ul>
        </div>
      )}

      <BarcodeScanner
        open={scanning}
        onOpenChange={setScanning}
        onDetect={(code) => {
          onChange(code);
          onSubmit(code);
        }}
      />
    </div>
  );
}
