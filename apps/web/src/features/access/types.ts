// Contrato da API de acessos (apps/api/src/access). Só tipos: nada aqui depende de React ou do Next.

export type MemberStatus = 'active' | 'invited' | 'inactive' | 'blocked' | 'unlinked';

export type Member = {
  sub: string;
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

export type DirectoryState = { mode: 'organization' | 'realm' | 'disabled'; status: 'ok' | 'off' | 'error'; message?: string };

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
export type InviteResult = { sub: string; userId: string; emailSent: boolean; accountCreated: boolean };
export type RoleInput = { name: string; description?: string | null; permissions: string[] };

/** Tudo que a tela precisa para abrir (buscado no servidor, depois mantido pelo React Query). */
export type AccessInitial = { me: Me; catalog: Catalog; roles: Role[]; members: MembersResponse };
