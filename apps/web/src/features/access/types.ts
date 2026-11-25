// Contrato da API de acessos (apps/api/src/access). Só tipos: nada aqui depende de React ou do Next.

export type MemberStatus = 'active' | 'invited' | 'inactive' | 'blocked' | 'unlinked';

export type Member = {
  /** `sub` do Keycloak. Convite que ainda aguarda a identidade usa `invite:<id>`. */
  sub: string;
  /** Só no convite que ainda aguarda a identidade no control plane: a única ação possível sobre ele é cancelar. */
  inviteId: string | null;
  userId: string | null;
  name: string;
  email: string;
  status: MemberStatus;
  roleIds: string[];
  lastSeenAt: string | null;
  createdAt: string | null;
  isSelf: boolean;
  isManager: boolean;
};

export type DirectoryState = { mode: 'control_plane' | 'disabled'; status: 'ok' | 'off' | 'error'; message?: string };

export type Seats = { max: number | null; used: number };

export type MembersResponse = { members: Member[]; directory: DirectoryState; seats: Seats };

export type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissions: string[];
  memberCount: number;
};

export type CatalogPermission = { key: string; label: string; risk: 'high' | null };
export type CatalogGroup = { key: string; label: string; description: string; permissions: CatalogPermission[] };
export type Catalog = { groups: CatalogGroup[] };

export type Me = { userId: string; permissions: string[] };

export type AuditItem = {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: 'member' | 'role';
  targetId: string;
  targetLabel: string | null;
  detail: Record<string, unknown> | null;
};
export type AuditPage = { items: AuditItem[]; nextCursor: string | null };

export type InviteInput = { email: string; name?: string; roleIds: string[] };
/**
 * `pending`: o control plane aceitou e vai criar a conta (fila assíncrona); o e-mail de senha sai quando ela fica pronta, então `emailSent` é `null`.
 * Sem `pending`, a pessoa já existia na organização e o acesso vale na hora.
 */
export type InviteResult = { sub: string; inviteId: string | null; userId: string | null; pending: boolean; emailSent: boolean | null; accountCreated: boolean };
export type RoleInput = { name: string; description?: string | null; permissions: string[] };

/** Tudo que a tela precisa para abrir (buscado no servidor, depois mantido pelo React Query). */
export type AccessInitial = { me: Me; catalog: Catalog; roles: Role[]; members: MembersResponse };
