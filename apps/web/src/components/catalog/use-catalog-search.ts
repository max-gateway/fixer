'use client';

import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { getJson } from '@/lib/client-api';
import type { CatalogSearch } from '@/lib/catalog';

/** A busca do catálogo só faz sentido com texto suficiente para filtrar; abaixo disso a plataforma devolveria o catálogo inteiro. */
export const MIN_CHARS = 2;
const LIMIT = 10;
const DEBOUNCE_MS = 250;

const searchOptions = (q: string) =>
  queryOptions({
    queryKey: ['catalog-search', q],
    // A API já repete o que é transitório e responde com uma mensagem pronta; repetir aqui só atrasaria o aviso.
    retry: false,
    staleTime: 10_000,
    queryFn: () => getJson<CatalogSearch>(`/api/catalog/parts/search?q=${encodeURIComponent(q)}&limit=${LIMIT}`, 'Não foi possível buscar no catálogo.'),
  });

/**
 * Busca no catálogo com debounce. Enquanto a próxima resposta não chega, a lista anterior continua na tela (`keepPreviousData`),
 * então digitar não faz a lista piscar; `busy` diz se há busca a caminho (digitando ou no ar) para o indicador de progresso.
 */
export function useCatalogSearch(text: string, enabled: boolean) {
  const [debounced, setDebounced] = useState(text.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const ready = debounced.length >= MIN_CHARS;
  const query = useQuery({ ...searchOptions(debounced), enabled: enabled && ready, placeholderData: keepPreviousData });
  const settling = text.trim() !== debounced && text.trim().length >= MIN_CHARS;
  return { query, ready, hits: ready ? (query.data?.data ?? []) : [], busy: enabled && ready && (query.isFetching || settling) };
}

/** Aquece o cache com o texto inicial quando a pessoa chega perto do botão: ao abrir, a lista já está lá. */
export function usePrefetchCatalogSearch(initialQuery: string) {
  const client = useQueryClient();
  return useCallback(() => {
    const q = initialQuery.trim();
    if (q.length >= MIN_CHARS) void client.prefetchQuery(searchOptions(q));
  }, [client, initialQuery]);
}
