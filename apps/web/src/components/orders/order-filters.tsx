'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Kbd } from '@/components/nav/kbd';
import { Input } from '@/components/ui/input';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import { cn } from '@/lib/utils';

const STATUSES = Object.keys(STATUS_LABEL) as OrderStatus[];

/** Busca (com debounce) e filtro de status na URL: link compartilhável, voltar/avançar funcionam, sem botão "Filtrar". */
export function OrderFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const status = sp.get('status') ?? '';
  const inputRef = useRef<HTMLInputElement>(null);

  function push(next: { q?: string; status?: string }) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) v ? params.set(k, v) : params.delete(k);
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  }

  useEffect(() => {
    if (q === (sp.get('q') ?? '')) return;
    const t = setTimeout(() => push({ q: q.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // "/" foca a busca, como no resto do app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || t.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por número, placa ou cliente"
          aria-label="Buscar ordens"
          className="h-11 pr-16 pl-9 text-[15px] [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute top-1/2 right-2.5 -translate-y-1/2">
          {q ? (
            <button type="button" aria-label="Limpar busca" onClick={() => (setQ(''), push({ q: '' }))} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted">
              <X className="size-4" />
            </button>
          ) : (
            <Kbd className="text-muted-foreground max-sm:hidden">/</Kbd>
          )}
        </div>
      </div>

      <div role="group" aria-label="Filtrar por status" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none]">
        {[{ value: '', label: 'Todas' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))].map((o) => {
          const active = status === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => push({ status: o.value })}
              className={cn(
                'h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
                active ? 'border-brand bg-brand text-white' : 'bg-card text-slate-600 hover:border-slate-400 hover:text-slate-900',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
