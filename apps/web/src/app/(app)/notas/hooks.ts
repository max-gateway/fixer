'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getJson, postJson } from '@/lib/client-api';
import type { FiscalStatus } from '@/lib/fiscal-import';
import type { InvoiceFull } from '@/lib/invoice-view';
import type { Listing, View } from '@/lib/invoices';

export type Initial = { view: View; q: string; listing: Listing; counts: Record<View, number>; status: FiscalStatus | null };

const KEY = ['invoices'] as const;
const POLL = 60_000;

const PAGE = 50;

const params = (view: View, q: string, skip: number) => {
  const p = new URLSearchParams({ view, take: String(PAGE), skip: String(skip) });
  if (q) p.set('q', q);
  return p;
};

/** Paginada por `skip` (a API limita 100 por chamada). Atualiza sozinha a cada minuto, só com a aba visível. */
export function useListing(view: View, q: string, initial: Initial) {
  const same = view === initial.view && q === initial.q;
  return useInfiniteQuery({
    queryKey: [...KEY, 'list', view, q],
    queryFn: ({ pageParam }) => getJson<Listing>(`/api/invoices?${params(view, q, pageParam)}`, 'Não foi possível carregar as notas.'),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total && last.items.length > 0 ? loaded : undefined;
    },
    initialData: same ? { pages: [initial.listing], pageParams: [0] } : undefined,
    placeholderData: keepPreviousData,
    refetchInterval: POLL,
  });
}

export const useCounts = (initial: Initial) =>
  useQuery({ queryKey: [...KEY, 'counts'], queryFn: () => getJson<Record<View, number>>('/api/invoices/summary'), initialData: initial.counts, refetchInterval: POLL });

export const useSyncStatus = (initial: Initial) =>
  useQuery({ queryKey: ['fiscal', 'status'], queryFn: () => getJson<FiscalStatus>('/api/fiscal/status'), initialData: initial.status ?? undefined, refetchInterval: POLL });

export const detailKey = (id: string) => [...KEY, 'detail', id] as const;

export const useDetail = (id: string | null) =>
  useQuery({ queryKey: detailKey(id ?? ''), queryFn: () => getJson<InvoiceFull>(`/api/invoices/${id}`), enabled: !!id, staleTime: 15_000 });

/** Aquece o cache do painel quando o ponteiro chega na linha, então o clique abre instantâneo. */
export function usePrefetchDetail() {
  const qc = useQueryClient();
  return (id: string) => void qc.prefetchQuery({ queryKey: detailKey(id), queryFn: () => getJson<InvoiceFull>(`/api/invoices/${id}`), staleTime: 15_000 });
}

export type ActionKind = 'confirm' | 'manifest' | 'clear-review';

const FALLBACK: Record<ActionKind, string> = {
  confirm: 'Não foi possível lançar a entrada.',
  manifest: 'Não foi possível dar a ciência.',
  'clear-review': 'Não foi possível liberar a nota.',
};

export type BulkResult = { ok: string[]; failed: { id: string; message: string }[] };

/** Ações por nota e em lote. Em lote, cada nota é independente: uma falha não derruba as outras. */
export function useInvoiceActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const run = (kind: ActionKind, id: string) => postJson<{ message?: string | null }>(`/api/invoices/${id}/${kind}`, {}, FALLBACK[kind]);

  return {
    one: useMutation({ mutationFn: ({ kind, id }: { kind: ActionKind; id: string }) => run(kind, id), onSettled: refresh }),
    many: useMutation({
      mutationFn: async ({ kind, ids }: { kind: ActionKind; ids: string[] }): Promise<BulkResult> => {
        const out: BulkResult = { ok: [], failed: [] };
        // Sequencial de propósito: lançar estoque e falar com a SEFAZ não deve disparar dezenas de chamadas de uma vez.
        for (const id of ids) {
          try {
            const r = await run(kind, id);
            if (kind === 'manifest' && r.message) out.failed.push({ id, message: r.message });
            else out.ok.push(id);
          } catch (e) {
            out.failed.push({ id, message: (e as Error).message });
          }
        }
        return out;
      },
      onSettled: refresh,
    }),
  };
}

/** Relógio que reavalia os tempos relativos ("há 3 min") sem refazer nenhuma busca. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function useMediaQuery(query: string, initial = false) {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}
