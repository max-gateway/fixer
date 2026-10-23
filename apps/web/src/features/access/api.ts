import { deleteJson, getJson, patchJson, postJson, putJson } from '@/lib/client-api';
import type { AuditPage, Catalog, InviteInput, InviteResult, Me, MembersResponse, Role, RoleInput } from './types';

/** Como falar HTTP. Injetável: os testes e outros hosts (ex.: um backoffice) trocam o transporte sem tocar nos componentes. */
export type Transport = {
  get<T>(path: string, fallback?: string): Promise<T>;
  post<T>(path: string, body: unknown, fallback?: string): Promise<T>;
  put<T>(path: string, body: unknown, fallback?: string): Promise<T>;
  patch<T>(path: string, body: unknown, fallback?: string): Promise<T>;
  del<T>(path: string, fallback?: string): Promise<T>;
};

/** Transporte padrão da web: o proxy `/api/*` do Next, que anexa o token e a oficina ativa. */
export const proxyTransport = (base = '/api'): Transport => ({
  get: (p, f) => getJson(`${base}${p}`, f),
  post: (p, b, f) => postJson(`${base}${p}`, b, f),
  put: (p, b, f) => putJson(`${base}${p}`, b, f),
  patch: (p, b, f) => patchJson(`${base}${p}`, b, f),
  del: (p, f) => deleteJson(`${base}${p}`, f),
});

const enc = encodeURIComponent;

/** Cliente tipado da API de acessos. Sem React: dá para usar em qualquer lugar. */
export function createAccessApi(t: Transport = proxyTransport()) {
  return {
    me: () => t.get<Me>('/access/me'),
    catalog: () => t.get<Catalog>('/access/catalog', 'Não foi possível carregar as permissões.'),
    roles: () => t.get<Role[]>('/access/roles', 'Não foi possível carregar os papéis.'),
    members: () => t.get<MembersResponse>('/access/members', 'Não foi possível carregar as pessoas.'),
    audit: (q: { cursor?: string | null; targetId?: string; take?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.cursor) p.set('cursor', q.cursor);
      if (q.targetId) p.set('targetId', q.targetId);
      if (q.take) p.set('take', String(q.take));
      return t.get<AuditPage>(`/access/audit?${p}`, 'Não foi possível carregar o histórico.');
    },

    invite: (body: InviteInput) => t.post<InviteResult>('/access/members', body, 'Não foi possível enviar o convite.'),
    setRoles: (sub: string, roleIds: string[]) => t.put<{ sub: string }>(`/access/members/${enc(sub)}/roles`, { roleIds }, 'Não foi possível salvar os papéis.'),
    deactivate: (sub: string) => t.post(`/access/members/${enc(sub)}/deactivate`, {}, 'Não foi possível desativar.'),
    reactivate: (sub: string) => t.post(`/access/members/${enc(sub)}/reactivate`, {}, 'Não foi possível reativar.'),
    remove: (sub: string) => t.del(`/access/members/${enc(sub)}`, 'Não foi possível remover.'),
    setupEmail: (sub: string) => t.post<{ sent: boolean; kind: 'invite' | 'password_reset' }>(`/access/members/${enc(sub)}/setup-email`, {}, 'Não foi possível enviar o e-mail.'),

    createRole: (body: RoleInput) => t.post<{ id: string }>('/access/roles', body, 'Não foi possível criar o papel.'),
    updateRole: (id: string, body: Partial<RoleInput>) => t.patch<{ id: string }>(`/access/roles/${enc(id)}`, body, 'Não foi possível salvar o papel.'),
    deleteRole: (id: string) => t.del<{ affectedMembers: number }>(`/access/roles/${enc(id)}`, 'Não foi possível excluir o papel.'),
  };
}

export type AccessApi = ReturnType<typeof createAccessApi>;
