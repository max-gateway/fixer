import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@fixer/db';
import type { AuthUser } from '../auth/auth.decorators.js';
import { PERMISSION_GROUPS, PERMISSIONS } from '../auth/permissions.catalog.js';
import { PlanLimits } from '../control-plane/plan-limits.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MembershipService } from '../tenancy/membership.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { AccessAudit } from './access-audit.service.js';
import type { CreateRoleInput, InviteInput, UpdateRoleInput } from './access.schemas.js';
import { DirectoryError, MEMBER_DIRECTORY, type DirectoryMember, type MemberDirectory } from './directory/member-directory.js';
import { AccessRuleViolation, assertAllowed, assertRoleName, managers, memberStatus, type MemberStatus, type Snapshot } from './domain/policy.js';

type Tx = Prisma.TransactionClient;

export interface MemberView {
  /** `sub` do Keycloak: identifica a pessoa nas rotas (existe mesmo para quem ainda não tem usuário no Fixer). */
  sub: string;
  userId: string | null;
  name: string;
  email: string;
  status: MemberStatus;
  roleIds: string[];
  lastSeenAt: Date | null;
  createdAt: Date | null;
  isSelf: boolean;
  isManager: boolean;
}

export interface DirectoryState {
  mode: MemberDirectory['mode'];
  status: 'ok' | 'off' | 'error';
  message?: string;
}

const httpError = (status: HttpStatus, error: string, message: string) => new HttpException({ statusCode: status, error, message }, status);

const RULE_STATUS: Record<AccessRuleViolation['code'], HttpStatus> = {
  last_manager: HttpStatus.CONFLICT,
  self_lockout: HttpStatus.CONFLICT,
  system_role: HttpStatus.CONFLICT,
  duplicate_role_name: HttpStatus.CONFLICT,
  unknown_role: HttpStatus.NOT_FOUND,
  unknown_user: HttpStatus.NOT_FOUND,
  unknown_permission: HttpStatus.UNPROCESSABLE_ENTITY,
  invalid_role_name: HttpStatus.UNPROCESSABLE_ENTITY,
};

const DIRECTORY_STATUS: Record<DirectoryError['code'], HttpStatus> = {
  directory_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  directory_misconfigured: HttpStatus.SERVICE_UNAVAILABLE,
  org_not_found: HttpStatus.CONFLICT,
  not_a_member: HttpStatus.NOT_FOUND,
  directory_error: HttpStatus.BAD_GATEWAY,
};

/** Traduz as falhas de regra e de diretório para HTTP com `error` estável; o resto segue como está. */
function translate(err: unknown): never {
  if (err instanceof AccessRuleViolation) throw httpError(RULE_STATUS[err.code], err.code, err.message);
  if (err instanceof DirectoryError) throw httpError(DIRECTORY_STATUS[err.code], err.code, err.message);
  throw err;
}

const diff = (before: readonly string[], after: readonly string[]) => ({
  added: after.filter((x) => !before.includes(x)),
  removed: before.filter((x) => !after.includes(x)),
});

/**
 * Casos de uso do controle de acesso (Configurações → Acessos). Orquestra três coisas desacopladas:
 * as regras puras (`domain/policy.ts`), o banco da oficina (RLS) e o diretório de identidades (porta `MemberDirectory`).
 *
 * Toda mudança que pode afetar quem administra roda numa transação com lock por organização: a fotografia que as regras
 * avaliam é a mesma que é gravada, e dois administradores ao mesmo tempo não deixam a oficina sem nenhum.
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);
  private catalogReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AccessAudit,
    private readonly limits: PlanLimits,
    private readonly membership: MembershipService,
    @Inject(MEMBER_DIRECTORY) private readonly directory: MemberDirectory,
  ) {}

  // ---------------------------------------------------------------- leitura

  /** Permissões do usuário logado (a web usa para mostrar ou esconder ações). */
  async me(user: AuthUser) {
    const rows = await this.prisma.permission.findMany({
      where: { roles: { some: { role: { users: { some: { userId: user.id } } } } } },
      select: { key: true },
    });
    return { userId: user.id, permissions: rows.map((r) => r.key).sort() };
  }

  catalog() {
    return {
      groups: PERMISSION_GROUPS.map((g) => ({ ...g, permissions: PERMISSIONS.filter((p) => p.group === g.key).map(({ key, label, risk }) => ({ key, label, risk: risk ?? null })) })),
    };
  }

  async roles() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        createdAt: true,
        permissions: { select: { permission: { select: { key: true } } } },
        users: { where: { user: { active: true } }, select: { userId: true } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      createdAt: r.createdAt,
      permissions: r.permissions.map((p) => p.permission.key).sort(),
      memberCount: r.users.length,
    }));
  }

  /** Pessoas da oficina: quem já tem usuário no Fixer + quem está no diretório da organização e ainda não tem acesso. */
  async members(actor: AuthUser): Promise<{ members: MemberView[]; directory: DirectoryState; seats: { max: number | null; used: number } }> {
    const [users, snapshot, seats] = await Promise.all([
      this.prisma.user.findMany({
        select: { id: true, keycloakId: true, name: true, email: true, active: true, lastSeenAt: true, createdAt: true, roles: { select: { roleId: true } } },
      }),
      this.snapshot(this.prisma),
      this.limits.userSeats(),
    ]);

    const { list, state } = await this.directoryMembers();
    const byId = new Map((list ?? []).map((m) => [m.id, m]));
    const managerIds = new Set(managers(snapshot));

    const members: MemberView[] = users.map((u) => {
      const d = byId.get(u.keycloakId);
      byId.delete(u.keycloakId);
      return {
        sub: u.keycloakId,
        userId: u.id,
        name: u.name,
        email: u.email,
        // Com o diretório lido, quem sumiu dele (removido da organização no Keycloak) aparece como bloqueado.
        status: memberStatus({ linked: true, active: u.active, lastSeenAt: u.lastSeenAt, directoryEnabled: list ? (d?.enabled ?? false) : null }),
        roleIds: u.roles.map((r) => r.roleId),
        lastSeenAt: u.lastSeenAt,
        createdAt: d?.createdAt ?? u.createdAt,
        isSelf: u.id === actor.id,
        isManager: managerIds.has(u.id),
      };
    });
    for (const d of byId.values()) {
      members.push({ sub: d.id, userId: null, name: d.name, email: d.email, status: 'unlinked', roleIds: [], lastSeenAt: null, createdAt: d.createdAt, isSelf: false, isManager: false });
    }
    members.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name, 'pt-BR'));
    return { members, directory: state, seats };
  }

  // ---------------------------------------------------------------- pessoas

  /**
   * Convida por e-mail: cria a conta no diretório (ou reaproveita a que existe), coloca na organização, cria o usuário da
   * oficina já com os papéis e manda o e-mail de definição de senha. Repetir o convite não duplica nada.
   */
  async invite(input: InviteInput, actor: AuthUser) {
    try {
      await this.assertRolesExist(input.roleIds);
      const existing = await this.prisma.user.findFirst({ where: { email: input.email }, select: { id: true, active: true } });
      if (existing?.active) throw httpError(HttpStatus.CONFLICT, 'already_member', 'Esta pessoa já tem acesso à oficina');
      await this.limits.assertActiveUserSlot();

      const result = await this.directory.invite(TenantContext.require(), { email: input.email, name: input.name });
      const m = result.member;
      const name = input.name?.trim() || (m.name !== m.email ? m.name : input.email);

      const user = await this.locked(async (tx) => {
        // Pode existir pelo sub (entrou antes por outro caminho) ou pelo e-mail (desativado): o sub do diretório vence.
        const prior = await tx.user.findFirst({ where: { OR: [{ keycloakId: m.id }, { email: input.email }] }, select: { id: true } });
        const u = prior
          ? await tx.user.update({ where: { id: prior.id }, data: { keycloakId: m.id, email: input.email, active: true }, select: { id: true } })
          : await tx.user.create({ data: { keycloakId: m.id, email: input.email, name, active: true }, select: { id: true } });
        await this.replaceRoles(tx, u.id, input.roleIds);
        await this.audit.record(
          actor,
          { action: 'member.invited', target: { type: 'member', id: m.id, label: input.email }, detail: { roles: await this.roleNames(tx, input.roleIds), emailSent: result.emailSent, accountCreated: result.created } },
          tx,
        );
        return u;
      });
      await this.membership.ensure({ keycloakId: m.id, email: input.email });
      return { sub: m.id, userId: user.id, emailSent: result.emailSent, accountCreated: result.created };
    } catch (err) {
      translate(err);
    }
  }

  /** Define os papéis da pessoa. Quem está só no diretório (sem usuário no Fixer) ganha o usuário aqui. */
  async setRoles(sub: string, roleIds: string[], actor: AuthUser) {
    try {
      let user = await this.prisma.user.findFirst({ where: { keycloakId: sub }, select: { id: true } });
      let linked = false;
      if (!user) {
        const d = await this.requireDirectoryMember(sub);
        if (roleIds.length === 0) return { sub, userId: null };
        await this.limits.assertActiveUserSlot();
        user = await this.prisma.user.create({ data: { keycloakId: d.id, email: d.email, name: d.name, active: true }, select: { id: true } });
        await this.membership.ensure({ keycloakId: d.id, email: d.email });
        linked = true;
      }
      const userId = user.id;
      await this.locked(async (tx) => {
        const snapshot = await this.snapshot(tx);
        const before = snapshot.users.find((u) => u.id === userId)?.roleIds ?? [];
        assertAllowed(snapshot, { kind: 'user.roles', userId, roleIds }, actor.id);
        await this.replaceRoles(tx, userId, roleIds);
        const d = diff(before, roleIds);
        await this.audit.record(
          actor,
          {
            action: linked ? 'member.linked' : 'member.roles_changed',
            target: { type: 'member', id: sub, label: await this.userLabel(tx, userId) },
            detail: { added: await this.roleNames(tx, d.added), removed: await this.roleNames(tx, d.removed) },
          },
          tx,
        );
      });
      return { sub, userId };
    } catch (err) {
      translate(err);
    }
  }

  /** Desativa ou reativa na oficina (o login nesta oficina é recusado; a conta no diretório continua). */
  async setActive(sub: string, active: boolean, actor: AuthUser) {
    try {
      const user = await this.requireUser(sub);
      if (user.active === active) return { sub, active };
      if (active) await this.limits.assertActiveUserSlot();
      await this.locked(async (tx) => {
        if (!active) assertAllowed(await this.snapshot(tx), { kind: 'user.active', userId: user.id, active }, actor.id);
        await tx.user.update({ where: { id: user.id }, data: { active } });
        await this.audit.record(actor, { action: active ? 'member.reactivated' : 'member.deactivated', target: { type: 'member', id: sub, label: user.email } }, tx);
      });
      return { sub, active };
    } catch (err) {
      translate(err);
    }
  }

  /**
   * Tira a pessoa da oficina: desativa, remove os papéis e a retira da organização no diretório. Primeiro o Fixer (o lado
   * seguro: sem acesso aqui), depois o diretório; se o diretório falhar, repetir a remoção completa o serviço.
   */
  async remove(sub: string, actor: AuthUser) {
    try {
      const user = await this.prisma.user.findFirst({ where: { keycloakId: sub }, select: { id: true, email: true } });
      if (user) {
        if (user.id === actor.id) throw httpError(HttpStatus.CONFLICT, 'self_lockout', 'Você não pode remover a si mesmo da oficina');
        await this.locked(async (tx) => {
          assertAllowed(await this.snapshot(tx), { kind: 'user.active', userId: user.id, active: false }, actor.id);
          await tx.userRole.deleteMany({ where: { userId: user.id } });
          await tx.user.update({ where: { id: user.id }, data: { active: false } });
          await this.audit.record(actor, { action: 'member.removed', target: { type: 'member', id: sub, label: user.email } }, tx);
        });
      } else {
        await this.requireDirectoryMember(sub);
      }
      if (this.directory.mode !== 'disabled') await this.directory.removeMember(TenantContext.require(), sub);
      await this.membership.remove(sub);
      return { sub, removed: true };
    } catch (err) {
      translate(err);
    }
  }

  /** Reenvia o convite (quem nunca entrou) ou o e-mail de redefinição de senha. */
  async sendSetupEmail(sub: string, actor: AuthUser) {
    try {
      const user = await this.requireUser(sub);
      const pendingInvite = !user.lastSeenAt;
      const sent = await this.directory.sendSetupEmail(sub, { pendingInvite });
      if (!sent) throw httpError(HttpStatus.BAD_GATEWAY, 'email_not_sent', 'O Keycloak não conseguiu enviar o e-mail (verifique o SMTP do realm)');
      await this.audit.record(actor, { action: 'member.setup_email', target: { type: 'member', id: sub, label: user.email }, detail: { kind: pendingInvite ? 'invite' : 'password_reset' } });
      return { sent: true, kind: pendingInvite ? 'invite' : 'password_reset' };
    } catch (err) {
      translate(err);
    }
  }

  // ---------------------------------------------------------------- papéis

  async createRole(input: CreateRoleInput, actor: AuthUser) {
    try {
      const keys = [...new Set(input.permissions)];
      this.assertCatalog(keys);
      await this.ensureCatalog();
      return await this.locked(async (tx) => {
        const name = assertRoleName(input.name, await tx.role.findMany({ select: { id: true, name: true } }));
        const role = await tx.role.create({ data: { name, description: input.description?.trim() || null }, select: { id: true } });
        await this.replacePermissions(tx, role.id, keys);
        await this.audit.record(actor, { action: 'role.created', target: { type: 'role', id: role.id, label: name }, detail: { permissions: keys } }, tx);
        return { id: role.id };
      });
    } catch (err) {
      translate(err);
    }
  }

  async updateRole(id: string, input: UpdateRoleInput, actor: AuthUser) {
    try {
      if (input.permissions) {
        this.assertCatalog(input.permissions);
        await this.ensureCatalog();
      }
      return await this.locked(async (tx) => {
        const snapshot = await this.snapshot(tx);
        const role = snapshot.roles.find((r) => r.id === id);
        if (!role) throw new AccessRuleViolation('unknown_role', 'Papel não encontrado');
        if (role.isSystem && input.name !== undefined && input.name.trim() !== role.name) {
          throw new AccessRuleViolation('system_role', 'O papel Admin não pode ser renomeado');
        }
        const name = input.name !== undefined ? assertRoleName(input.name, snapshot.roles, id) : role.name;
        const detail: Record<string, unknown> = {};
        if (input.permissions) {
          const keys = [...new Set(input.permissions)];
          assertAllowed(snapshot, { kind: 'role.permissions', roleId: id, permissions: keys }, actor.id);
          await this.replacePermissions(tx, id, keys);
          Object.assign(detail, diff(role.permissions, keys));
        }
        if (name !== role.name) detail.renamed = { from: role.name, to: name };
        await tx.role.update({ where: { id }, data: { name, ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}) } });
        await this.audit.record(actor, { action: 'role.updated', target: { type: 'role', id, label: name }, detail }, tx);
        return { id };
      });
    } catch (err) {
      translate(err);
    }
  }

  async deleteRole(id: string, actor: AuthUser) {
    try {
      return await this.locked(async (tx) => {
        const snapshot = await this.snapshot(tx);
        assertAllowed(snapshot, { kind: 'role.delete', roleId: id }, actor.id);
        const role = snapshot.roles.find((r) => r.id === id)!;
        const affected = snapshot.users.filter((u) => u.roleIds.includes(id)).length;
        await tx.role.delete({ where: { id } });
        await this.audit.record(actor, { action: 'role.deleted', target: { type: 'role', id, label: role.name }, detail: { affectedMembers: affected } }, tx);
        return { id, affectedMembers: affected };
      });
    } catch (err) {
      translate(err);
    }
  }

  // ---------------------------------------------------------------- internos

  /** Transação com lock exclusivo da organização (só serializa mudanças de acesso da MESMA oficina). */
  private locked<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const key = `access:${TenantContext.require()}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
      return fn(tx);
    }) as Promise<T>;
  }

  private async snapshot(db: Tx | PrismaService): Promise<Snapshot> {
    const [roles, users] = await Promise.all([
      db.role.findMany({ select: { id: true, name: true, isSystem: true, permissions: { select: { permission: { select: { key: true } } } } } }),
      db.user.findMany({ select: { id: true, active: true, roles: { select: { roleId: true } } } }),
    ]);
    return {
      roles: roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem, permissions: r.permissions.map((p) => p.permission.key) })),
      users: users.map((u) => ({ id: u.id, active: u.active, roleIds: u.roles.map((r) => r.roleId) })),
    };
  }

  private async replaceRoles(tx: Tx, userId: string, roleIds: readonly string[]) {
    await tx.userRole.deleteMany({ where: { userId, roleId: { notIn: [...roleIds] } } });
    if (roleIds.length) await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId })), skipDuplicates: true });
  }

  private async replacePermissions(tx: Tx, roleId: string, keys: readonly string[]) {
    const perms = keys.length ? await tx.permission.findMany({ where: { key: { in: [...keys] } }, select: { id: true } }) : [];
    await tx.rolePermission.deleteMany({ where: { roleId, permissionId: { notIn: perms.map((p) => p.id) } } });
    if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })), skipDuplicates: true });
  }

  private assertCatalog(keys: readonly string[]) {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) throw new AccessRuleViolation('unknown_permission', `Permissão desconhecida: ${unknown.join(', ')}`);
  }

  /** `Permission` é referência compartilhada; garante as linhas do catálogo atual antes de ligá-las a um papel. */
  private async ensureCatalog() {
    if (this.catalogReady) return;
    await this.prisma.permission.createMany({ data: PERMISSIONS.map((p) => ({ key: p.key, label: p.label })), skipDuplicates: true });
    this.catalogReady = true;
  }

  private async assertRolesExist(ids: readonly string[]) {
    const found = await this.prisma.role.count({ where: { id: { in: [...ids] } } });
    if (found !== new Set(ids).size) throw new AccessRuleViolation('unknown_role', 'Papel não encontrado');
  }

  private async roleNames(tx: Tx, ids: readonly string[]) {
    if (!ids.length) return [];
    return (await tx.role.findMany({ where: { id: { in: [...ids] } }, select: { name: true } })).map((r) => r.name);
  }

  private async userLabel(tx: Tx, userId: string) {
    return (await tx.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null;
  }

  private async requireUser(sub: string) {
    const user = await this.prisma.user.findFirst({ where: { keycloakId: sub }, select: { id: true, email: true, active: true, lastSeenAt: true } });
    if (!user) throw new AccessRuleViolation('unknown_user', 'Pessoa não encontrada nesta oficina');
    return user;
  }

  private async requireDirectoryMember(sub: string): Promise<DirectoryMember> {
    const d = await this.directory.getMember(TenantContext.require(), sub);
    if (!d) throw new AccessRuleViolation('unknown_user', 'Pessoa não encontrada nesta oficina');
    return d;
  }

  private async directoryMembers(): Promise<{ list: DirectoryMember[] | null; state: DirectoryState }> {
    if (this.directory.mode === 'disabled') return { list: null, state: { mode: 'disabled', status: 'off' } };
    try {
      return { list: await this.directory.listMembers(TenantContext.require()), state: { mode: this.directory.mode, status: 'ok' } };
    } catch (err) {
      // A tela continua útil sem o diretório: mostra quem já tem usuário e avisa.
      const message = err instanceof DirectoryError ? err.message : 'Falha ao consultar o diretório';
      this.logger.warn(`Diretório indisponível: ${(err as Error).message}`);
      return { list: null, state: { mode: this.directory.mode, status: 'error', message } };
    }
  }
}

