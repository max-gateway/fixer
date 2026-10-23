'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { createAccessApi, type AccessApi } from './api';
import type { AccessInitial, InviteInput, RoleInput } from './types';

const KEY = ['access'] as const;

/** O cliente da API vem por contexto: o padrão usa o proxy da web; testes e outros hosts injetam o seu. */
export const AccessApiContext = createContext<AccessApi>(createAccessApi());
const useApi = () => useContext(AccessApiContext);

export function useAccessData(initial: AccessInitial) {
  const api = useApi();
  const me = useQuery({ queryKey: [...KEY, 'me'], queryFn: api.me, initialData: initial.me, staleTime: 30_000 });
  const catalog = useQuery({ queryKey: [...KEY, 'catalog'], queryFn: api.catalog, initialData: initial.catalog, staleTime: Infinity });
  const roles = useQuery({ queryKey: [...KEY, 'roles'], queryFn: api.roles, initialData: initial.roles });
  const members = useQuery({ queryKey: [...KEY, 'members'], queryFn: api.members, initialData: initial.members });
  return { me: me.data, catalog: catalog.data, roles: roles.data, members: members.data, refreshing: roles.isFetching || members.isFetching };
}

export function useAudit(targetId?: string) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: [...KEY, 'audit', targetId ?? 'all'],
    queryFn: ({ pageParam }) => api.audit({ cursor: pageParam, targetId, take: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Mutações: todas renovam pessoas, papéis, permissões do próprio usuário e histórico ao terminar. */
export function useAccessActions() {
  const api = useApi();
  const qc = useQueryClient();
  const onSettled = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    invite: useMutation({ mutationFn: (b: InviteInput) => api.invite(b), onSettled }),
    setRoles: useMutation({ mutationFn: ({ sub, roleIds }: { sub: string; roleIds: string[] }) => api.setRoles(sub, roleIds), onSettled }),
    deactivate: useMutation({ mutationFn: (sub: string) => api.deactivate(sub), onSettled }),
    reactivate: useMutation({ mutationFn: (sub: string) => api.reactivate(sub), onSettled }),
    remove: useMutation({ mutationFn: (sub: string) => api.remove(sub), onSettled }),
    setupEmail: useMutation({ mutationFn: (sub: string) => api.setupEmail(sub), onSettled }),
    createRole: useMutation({ mutationFn: (b: RoleInput) => api.createRole(b), onSettled }),
    updateRole: useMutation({ mutationFn: ({ id, ...b }: Partial<RoleInput> & { id: string }) => api.updateRole(id, b), onSettled }),
    deleteRole: useMutation({ mutationFn: (id: string) => api.deleteRole(id), onSettled }),
  };
}
