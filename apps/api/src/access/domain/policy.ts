import { ACCESS_MANAGE, PERMISSIONS } from '../../auth/permissions.catalog.js';

/**
 * Regras do controle de acesso, puras (sem banco, sem Keycloak, sem Nest): recebem uma fotografia da organização e a
 * mudança pretendida e dizem se ela pode acontecer. O serviço tira a fotografia dentro de uma transação com lock por
 * organização, então dois administradores agindo ao mesmo tempo não conseguem, juntos, deixar a oficina sem ninguém.
 */

export interface RoleSnapshot {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: readonly string[];
}

export interface UserSnapshot {
  id: string;
  active: boolean;
  roleIds: readonly string[];
}

export interface Snapshot {
  roles: readonly RoleSnapshot[];
  users: readonly UserSnapshot[];
}

export type Change =
  | { kind: 'user.roles'; userId: string; roleIds: readonly string[] }
  | { kind: 'user.active'; userId: string; active: boolean }
  | { kind: 'role.permissions'; roleId: string; permissions: readonly string[] }
  | { kind: 'role.delete'; roleId: string };

export type ViolationCode =
  | 'last_manager'
  | 'self_lockout'
  | 'system_role'
  | 'unknown_role'
  | 'unknown_user'
  | 'unknown_permission'
  | 'invalid_role_name'
  | 'duplicate_role_name';

/** Mudança recusada por regra de negócio. O `code` é estável (a tela decide a mensagem por ele, se quiser). */
export class AccessRuleViolation extends Error {
  constructor(
    readonly code: ViolationCode,
    message: string,
  ) {
    super(message);
  }
}

const CATALOG = new Set(PERMISSIONS.map((p) => p.key));

/** Permissões efetivas de um usuário: união das permissões dos papéis. Usuário inativo não tem nenhuma. */
export function effectivePermissions(snapshot: Snapshot, userId: string): Set<string> {
  const user = snapshot.users.find((u) => u.id === userId);
  if (!user?.active) return new Set();
  const byId = new Map(snapshot.roles.map((r) => [r.id, r]));
  return new Set(user.roleIds.flatMap((id) => byId.get(id)?.permissions ?? []));
}

/** Quem pode administrar os acessos (ativo e com `access.manage` por algum papel). */
export function managers(snapshot: Snapshot): string[] {
  return snapshot.users.filter((u) => effectivePermissions(snapshot, u.id).has(ACCESS_MANAGE)).map((u) => u.id);
}

/** Aplica a mudança numa cópia da fotografia (não valida; quem valida é `assertAllowed`). */
export function apply(snapshot: Snapshot, change: Change): Snapshot {
  switch (change.kind) {
    case 'user.roles':
      return { ...snapshot, users: snapshot.users.map((u) => (u.id === change.userId ? { ...u, roleIds: [...change.roleIds] } : u)) };
    case 'user.active':
      return { ...snapshot, users: snapshot.users.map((u) => (u.id === change.userId ? { ...u, active: change.active } : u)) };
    case 'role.permissions':
      return { ...snapshot, roles: snapshot.roles.map((r) => (r.id === change.roleId ? { ...r, permissions: [...change.permissions] } : r)) };
    case 'role.delete':
      return {
        roles: snapshot.roles.filter((r) => r.id !== change.roleId),
        users: snapshot.users.map((u) => ({ ...u, roleIds: u.roleIds.filter((id) => id !== change.roleId) })),
      };
  }
}

/**
 * Recusa a mudança que:
 * - mexe no papel de sistema (Admin tem sempre o catálogo inteiro e não pode ser apagado);
 * - cita papel, usuário ou permissão que não existe;
 * - tira do próprio autor o poder de administrar acessos (ele ficaria trancado para fora no meio da tarefa);
 * - deixa a organização sem nenhum administrador de acessos ativo.
 */
export function assertAllowed(snapshot: Snapshot, change: Change, actorId: string): Snapshot {
  const roleIds = new Set(snapshot.roles.map((r) => r.id));
  const role = (id: string) => {
    const r = snapshot.roles.find((x) => x.id === id);
    if (!r) throw new AccessRuleViolation('unknown_role', 'Papel não encontrado');
    return r;
  };
  const user = (id: string) => {
    if (!snapshot.users.some((u) => u.id === id)) throw new AccessRuleViolation('unknown_user', 'Pessoa não encontrada nesta oficina');
  };

  switch (change.kind) {
    case 'user.roles':
      user(change.userId);
      for (const id of change.roleIds) if (!roleIds.has(id)) throw new AccessRuleViolation('unknown_role', 'Papel não encontrado');
      break;
    case 'user.active':
      user(change.userId);
      break;
    case 'role.permissions': {
      if (role(change.roleId).isSystem) throw new AccessRuleViolation('system_role', 'As permissões do papel Admin não podem ser alteradas');
      const unknown = change.permissions.filter((p) => !CATALOG.has(p));
      if (unknown.length) throw new AccessRuleViolation('unknown_permission', `Permissão desconhecida: ${unknown.join(', ')}`);
      break;
    }
    case 'role.delete':
      if (role(change.roleId).isSystem) throw new AccessRuleViolation('system_role', 'O papel Admin não pode ser excluído');
      break;
  }

  const after = apply(snapshot, change);
  const before = new Set(managers(snapshot));
  const now = new Set(managers(after));
  if (before.has(actorId) && !now.has(actorId)) {
    throw new AccessRuleViolation('self_lockout', 'Você perderia o acesso a esta tela. Peça a outro administrador para fazer essa mudança.');
  }
  // Só recusa se a mudança PIORA a situação: uma organização que já está sem administrador (ex.: dados antigos) ainda pode ser consertada.
  if (before.size > 0 && now.size === 0) {
    throw new AccessRuleViolation('last_manager', 'A oficina ficaria sem ninguém para administrar os acessos.');
  }
  return after;
}

/** Nome de papel: 2 a 40 caracteres, único na organização sem diferenciar maiúsculas/acentos. */
export function assertRoleName(name: string, existing: readonly { id: string; name: string }[], selfId?: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 40) throw new AccessRuleViolation('invalid_role_name', 'O nome do papel deve ter de 2 a 40 caracteres');
  const key = fold(clean);
  if (existing.some((r) => r.id !== selfId && fold(r.name) === key)) {
    throw new AccessRuleViolation('duplicate_role_name', `Já existe um papel chamado "${clean}"`);
  }
  return clean;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export type MemberStatus = 'active' | 'invited' | 'inactive' | 'blocked' | 'unlinked';

/**
 * Situação de uma pessoa na tela, combinando o Fixer (usuário da oficina) e o diretório (Keycloak):
 * - `unlinked`: está no diretório da organização, mas ainda não tem acesso ao Fixer (nenhum papel atribuído);
 * - `inactive`: desativada na oficina (o login é recusado aqui; continua existindo no diretório);
 * - `blocked`: a conta está desabilitada no próprio diretório;
 * - `invited`: tem acesso, mas nunca entrou;
 * - `active`: já entrou ao menos uma vez.
 */
export function memberStatus(m: { linked: boolean; active: boolean; lastSeenAt: Date | null; directoryEnabled: boolean | null }): MemberStatus {
  if (!m.linked) return 'unlinked';
  if (!m.active) return 'inactive';
  if (m.directoryEnabled === false) return 'blocked';
  if (!m.lastSeenAt) return 'invited';
  return 'active';
}
