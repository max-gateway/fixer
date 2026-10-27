'use client';

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/toaster';
import { getJson, postJson } from '@/lib/client-api';
import { isSearchable, normalizeResult, searchUrl, type PartDetail, type PartHit, type ResolvedFiscal, type SearchResult, type SearchState, type Suggestion, type WorkshopStock } from '@/lib/part-search';

/** Peça da oficina como `GET /parts` a devolve (decimais chegam como texto). */
export type LocalPart = { id: string; sku: string; name: string; costPrice: string; sellPrice: string; stockQty: string; catalogSku: string | null };

export type PartHistory = {
  part: LocalPart & { avgCost: string | null };
  totals: { purchases: number; boughtQty: string | number; sales: number; soldQty: string | number };
  purchases: {
    id: string;
    createdAt: string;
    quantity: string;
    unitCost: string | null;
    note: string | null;
    purchaseInvoiceItem: { invoice: { id: string; number: number | null; issuerName: string; issuedAt: string | null } } | null;
  }[];
  sales: {
    id: string;
    createdAt: string;
    quantity: string;
    unitPrice: string;
    unitCost: string | null;
    serviceOrder: { id: string; number: number; status: string; customer: { name: string }; vehicle: { plate: string; brand: string; model: string } };
  }[];
  prices: { id: string; createdAt: string; costBefore: string | null; costAfter: string; sellBefore: string | null; sellAfter: string; marginAfter: string | null; source: 'INVOICE' | 'MANUAL' | 'AUTO' | 'REVERSAL' }[];
};

const SEARCH_ERROR = 'Não foi possível buscar no catálogo.';

/** Resultado da busca. Enquanto a próxima página chega, a anterior continua na tela, então filtrar e paginar não pisca. */
export function usePartSearch(state: SearchState) {
  const url = searchUrl(state);
  return useQuery({
    queryKey: ['part-search', url],
    enabled: isSearchable(state),
    retry: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SearchResult> => normalizeResult(await getJson<SearchResult>(url, SEARCH_ERROR)),
  });
}

/** Com `vehicleId`, cada sugestão vem marcada com `compatibleWithVehicle`. */
export function useSuggestions(text: string, enabled: boolean, vehicleId?: string) {
  const q = text.trim();
  return useQuery({
    queryKey: ['part-suggest', q, vehicleId ?? null],
    enabled: enabled && q.length >= 2,
    retry: false,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: () => getJson<{ data: Suggestion[] }>(`/api/catalog/parts/autocomplete?q=${encodeURIComponent(q)}&limit=8${vehicleId ? `&vehicleId=${encodeURIComponent(vehicleId)}` : ''}`, SEARCH_ERROR),
  });
}

export function usePartDetail(sku: string | undefined) {
  return useQuery({
    queryKey: ['part-detail', sku],
    enabled: Boolean(sku),
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => getJson<PartDetail>(`/api/catalog/parts/${encodeURIComponent(sku!)}`, 'Não foi possível abrir a ficha da peça.'),
  });
}

/** Classificação fiscal da peça para a oficina (exige a permissão de ver a precificação). */
export function useFiscal(sku: string) {
  return useQuery({
    queryKey: ['part-fiscal', sku],
    retry: false,
    staleTime: 60_000,
    queryFn: () => getJson<{ fiscal: ResolvedFiscal | null }>(`/api/catalog/parts/${encodeURIComponent(sku)}/fiscal`, 'Não foi possível consultar a classificação fiscal.'),
  });
}

/** A peça serve neste veículo? Só com o id do veículo (a família montadora/modelo não tem uma resposta única). */
export function useFits(sku: string | undefined, vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['part-fits', sku, vehicleId],
    enabled: Boolean(sku && vehicleId),
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => getJson<{ compatible: boolean }>(`/api/catalog/parts/${encodeURIComponent(sku!)}/fits/${encodeURIComponent(vehicleId!)}`, 'Não foi possível checar a compatibilidade.'),
  });
}

/** Saldo e preço de venda da oficina para os skus de uma página de resultados, por sku do catálogo. Peça sem vínculo não aparece no mapa. */
export function useWorkshopStock(skus: string[]) {
  const key = [...skus].sort().join(',');
  return useQuery({
    queryKey: ['workshop-stock', key],
    enabled: skus.length > 0,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Map<string, WorkshopStock>> => {
      const { items } = await getJson<{ items: WorkshopStock[] }>(`/api/catalog/workshop/stock?${skus.map((s) => `skus=${encodeURIComponent(s)}`).join('&')}`, 'Não foi possível consultar o estoque da oficina.');
      return new Map(items.map((i) => [i.catalogSku, i]));
    },
  });
}

/** Cadastra a peça do catálogo na oficina (nome e GTIN vêm do catálogo) e atualiza os saldos que a tela mostra. */
export function useRegisterPart(sku: string, name: string, onDone?: () => void) {
  const { toast } = useToast();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { costPrice: number; sellPrice: number }) => postJson('/api/parts/from-catalog', { catalogSku: sku, ...v }, 'Não foi possível cadastrar a peça.'),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['local-part', sku] }), client.invalidateQueries({ queryKey: ['workshop-stock'] }), client.invalidateQueries({ queryKey: ['part-search'] })]);
      toast({ title: 'Peça cadastrada na oficina', description: name, tone: 'success' });
      onDone?.();
    },
    onError: (e) => toast({ title: e.message, tone: 'error' }),
  });
}

/** A peça da oficina vinculada a esta peça do catálogo (se houver). */
export function useLocalPart(catalogSku: string | undefined) {
  return useQuery({
    queryKey: ['local-part', catalogSku],
    enabled: Boolean(catalogSku),
    retry: false,
    queryFn: async () => (await getJson<LocalPart[]>(`/api/parts?catalogSku=${encodeURIComponent(catalogSku!)}`, 'Não foi possível consultar o estoque da oficina.'))[0] ?? null,
  });
}

export function usePartHistory(partId: string | undefined) {
  return useQuery({
    queryKey: ['part-history', partId],
    enabled: Boolean(partId),
    retry: false,
    queryFn: () => getJson<PartHistory>(`/api/parts/${partId}/history`, 'Não foi possível carregar o histórico.'),
  });
}

/** Ficha de várias peças (comparador), compartilhando o cache com a gaveta. */
export function usePartDetails(skus: string[]) {
  return useQueries({
    queries: skus.map((sku) => ({
      queryKey: ['part-detail', sku],
      retry: false,
      staleTime: 5 * 60_000,
      queryFn: () => getJson<PartDetail>(`/api/catalog/parts/${encodeURIComponent(sku)}`, 'Não foi possível abrir a ficha da peça.'),
    })),
  });
}

/** Estado persistido no navegador. Lê depois de montar (sem divergir do HTML do servidor) e nunca quebra se o armazenamento estiver bloqueado. */
export function useStored<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* armazenamento indisponível: segue com o padrão */
    }
  }, [key]);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(v));
        } catch {
          /* idem */
        }
        return v;
      });
    },
    [key],
  );
  return [value, set];
}

export type { PartHit };
