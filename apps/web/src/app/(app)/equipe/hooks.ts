'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getJson, patchJson, postJson } from '@/lib/client-api';
import { filtersToParams, PAGE_SIZE, type Engagement, type EngagementKind, type Filters, type Person, type PersonDetail, type PersonPage, type Position, type Unit } from '@/lib/workforce';

export type Initial = { filters: Filters; page: PersonPage; units: Unit[]; positions: Position[] };

const KEY = ['workforce'] as const;
const listKey = (f: Filters) => [...KEY, 'people', filtersToParams(f).toString()] as const;

/** Só a primeira consulta usa o que o servidor já buscou; mudou o filtro, busca de novo. */
export function usePeople(filters: Filters, initial: Initial) {
  const same = listKey(filters).join('|') === listKey(initial.filters).join('|');
  return useInfiniteQuery({
    queryKey: listKey(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const p = filtersToParams(filters);
      if (pageParam) p.set('cursor', pageParam);
      return getJson<PersonPage>(`/api/workforce/people?${p}`, 'Não foi possível carregar a equipe.');
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...(same ? { initialData: { pages: [initial.page], pageParams: [undefined] } } : {}),
    placeholderData: (prev) => prev,
  });
}

export const usePerson = (id: string | null) =>
  useQuery({ queryKey: [...KEY, 'person', id], queryFn: () => getJson<PersonDetail>(`/api/workforce/people/${id}`, 'Não foi possível carregar a pessoa.'), enabled: !!id });

export const useUnits = (initial: Initial) =>
  useQuery({ queryKey: [...KEY, 'units'], queryFn: async () => (await getJson<{ items: Unit[] }>('/api/workforce/units')).items, initialData: initial.units, staleTime: 60_000 });

export const usePositions = (initial: Initial) =>
  useQuery({ queryKey: [...KEY, 'positions'], queryFn: async () => (await getJson<{ items: Position[] }>('/api/workforce/positions')).items, initialData: initial.positions, staleTime: 60_000 });

export type PersonInput = { cpf: string; name: string; socialName?: string | null; birthDate?: string | null; email?: string | null; phone?: string | null };
export type PersonPatch = { version: number; name?: string; socialName?: string | null; birthDate?: string | null; email?: string | null; phone?: string | null; status?: 'active' | 'inactive' };
export type EngagementInput = { kind: EngagementKind; unitId?: string | null; admittedOn: string; positionKey?: string };

/** Toda escrita invalida a equipe inteira: a lista, a ficha aberta e os vínculos andam juntos, e o dado é pequeno. */
export function useWorkforceActions() {
  const qc = useQueryClient();
  const done = <T,>(v: T) => qc.invalidateQueries({ queryKey: KEY }).then(() => v);
  return {
    create: useMutation({ mutationFn: (b: PersonInput) => postJson<Person>('/api/workforce/people', b, 'Não foi possível cadastrar.').then(done) }),
    update: useMutation({ mutationFn: ({ id, ...b }: PersonPatch & { id: string }) => patchJson<Person>(`/api/workforce/people/${id}`, b, 'Não foi possível salvar.').then(done) }),
    admit: useMutation({ mutationFn: ({ personId, ...b }: EngagementInput & { personId: string }) => postJson<Engagement>(`/api/workforce/people/${personId}/engagements`, b, 'Não foi possível admitir.').then(done) }),
    assign: useMutation({ mutationFn: ({ engagementId, ...b }: { engagementId: string; positionKey: string; validFrom: string }) => postJson<Engagement>(`/api/workforce/engagements/${engagementId}/positions`, b, 'Não foi possível atribuir a função.').then(done) }),
    terminate: useMutation({
      mutationFn: ({ engagementId, ...b }: { engagementId: string; terminatedOn: string; reason: string }) =>
        postJson<Engagement & { lastActive: boolean }>(`/api/workforce/engagements/${engagementId}/terminate`, b, 'Não foi possível encerrar o vínculo.').then(done),
    }),
  };
}

export { PAGE_SIZE };
