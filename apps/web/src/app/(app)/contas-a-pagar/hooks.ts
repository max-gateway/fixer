'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getJson, patchJson, postJson } from '@/lib/client-api';
import {
  filtersToParams,
  type BoletoInfo,
  type Filters,
  type Forecast,
  type Listing,
  type PayableDetail,
  type PaymentMethod,
  type Summary,
  type Supplier,
} from '@/lib/payables';

export type Initial = { filters: Filters; limit: number; listing: Listing; summary: Summary; forecast: Forecast };

const KEY = ['payables'] as const;
export const listKey = (f: Filters, limit: number) => [...KEY, 'list', filtersToParams(f, { forApi: true }).toString(), limit] as const;

/** Só a primeira consulta usa o que o servidor já buscou; mudou o filtro, busca de novo. */
const seed = <T>(matches: boolean, data: T | undefined) => (matches ? data : undefined);

export function useListing(f: Filters, limit: number, initial: Initial) {
  const key = listKey(f, limit);
  const same = key.join('|') === listKey(initial.filters, initial.limit).join('|');
  return useQuery({
    queryKey: key,
    queryFn: () => getJson<Listing>(`/api/payables?${filtersToParams(f, { forApi: true })}&take=${limit}`, 'Não foi possível carregar as contas.'),
    initialData: seed(same, initial.listing),
    placeholderData: keepPreviousData,
  });
}

export const useSummary = (initial: Initial) =>
  useQuery({ queryKey: [...KEY, 'summary'], queryFn: () => getJson<Summary>('/api/payables/summary'), initialData: initial.summary });

export const useForecast = (initial: Initial) =>
  useQuery({ queryKey: [...KEY, 'forecast'], queryFn: () => getJson<Forecast>('/api/payables/forecast'), initialData: initial.forecast });

export const useSuppliers = () => useQuery({ queryKey: [...KEY, 'suppliers'], queryFn: () => getJson<Supplier[]>('/api/payables/suppliers'), staleTime: 60_000 });

export const useCategories = () => useQuery({ queryKey: [...KEY, 'categories'], queryFn: () => getJson<string[]>('/api/payables/categories'), staleTime: 5 * 60_000 });

export const useDetail = (id: string | null) =>
  useQuery({ queryKey: [...KEY, 'detail', id], queryFn: () => getJson<PayableDetail>(`/api/payables/${id}`), enabled: !!id });

export async function lookupBarcode(code: string): Promise<BoletoInfo> {
  return getJson<BoletoInfo>(`/api/payables/barcode?code=${encodeURIComponent(code)}`);
}

export async function findDuplicates(supplier: string, amount: number, dueDate: string) {
  const q = new URLSearchParams({ supplier, amount: String(amount), dueDate });
  return getJson<{ id: string; supplierName: string; documentNumber: string | null; dueDate: string; amount: string; status: string }[]>(`/api/payables/duplicates?${q}`);
}

export type PayInput = { paidAt?: string; method?: PaymentMethod; interest?: number; discount?: number };
export type CreateInput = {
  supplierName: string;
  supplierCnpj?: string;
  description?: string;
  category?: string;
  documentNumber?: string;
  barcode?: string;
  dueDate: string;
  amount: number;
  installments: number;
  notes?: string;
};
export type UpdateInput = Partial<{ dueDate: string; amount: number; notes: string | null; category: string | null; description: string | null; barcode: string | null; supplierName: string }>;
export type BulkInput = { ids: string[]; action: 'pay' | 'unpay' | 'cancel'; paidAt?: string; method?: PaymentMethod };

/** Mutações: todas invalidam o cache de contas (lista, resumo, previsão e detalhe) ao terminar. */
export function usePayableActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    pay: useMutation({
      mutationFn: ({ id, ...body }: PayInput & { id: string }) => postJson<PayableDetail>(`/api/payables/${id}/pay`, body, 'Não foi possível registrar o pagamento.'),
      onSettled: refresh,
    }),
    unpay: useMutation({ mutationFn: (id: string) => postJson(`/api/payables/${id}/unpay`, {}, 'Não foi possível desfazer o pagamento.'), onSettled: refresh }),
    cancel: useMutation({ mutationFn: (id: string) => postJson(`/api/payables/${id}/cancel`, {}, 'Não foi possível cancelar a conta.'), onSettled: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...body }: UpdateInput & { id: string }) => patchJson<PayableDetail>(`/api/payables/${id}`, body, 'Não foi possível salvar a alteração.'),
      onSettled: refresh,
    }),
    create: useMutation({ mutationFn: (body: CreateInput) => postJson<{ id: string }[]>('/api/payables', body, 'Não foi possível lançar a conta.'), onSettled: refresh }),
    bulk: useMutation({
      mutationFn: (body: BulkInput) => postJson<{ done: string[]; skipped: string[] }>('/api/payables/bulk', body, 'Não foi possível concluir a ação em lote.'),
      onSettled: refresh,
    }),
  };
}
