import type { PrismaClient } from '@fixer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.decorators.js';
import { PendingInviteService } from '../control-plane/pending-invite.service.js';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { tenantClient } from '../../test/db.js';
import { TEST_ORG } from '../../test/setup.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { AccessAudit } from './access-audit.service.js';
import { AccessService } from './access.service.js';
import type { InviteResult, MemberDirectory } from './directory/member-directory.js';

/**
 * Convite e lista de pessoas contra Postgres REAL (RLS), com o diretório simulado. Prova o contrato novo: o control plane cria a conta de forma assíncrona,
 * então o convite de quem ainda não existe fica PENDENTE no Fixer (só a intenção, os papéis) e o usuário só nasce quando a identidade fica pronta.
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const A = TEST_ORG;

describe.skipIf(!URL)('AccessService: convite pelo control plane (Postgres, RLS)', () => {
  let db: PrismaClient;
  let release: () => Promise<void>;
  let service: AccessService;
  let actor: AuthUser;
  let balcao: string;
  let invite: ReturnType<typeof vi.fn>;
  let republish: ReturnType<typeof vi.fn>;

  const run = <T>(fn: () => Promise<T>) => TenantContext.run(A, fn);
  const wipe = () =>
    run(async () => {
      await db.accessAuditLog.deleteMany();
      await db.pendingInvite.deleteMany();
      await db.userRole.deleteMany();
      await db.user.deleteMany();
      await db.role.deleteMany();
    });

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    db = tenantClient(URL!);
    await wipe();
  }, 60_000);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
    await release();
  }, 60_000);

  beforeEach(async () => {
    await wipe();
    const { admin, role } = await run(async () => {
      const r = await db.role.create({ data: { name: 'Balcão' } });
      const adminRole = await db.role.create({ data: { name: 'Admin', isSystem: true } });
      const u = await db.user.create({ data: { keycloakId: 'sub-admin', email: 'admin@oficina.com', name: 'Ana Admin', active: true, roles: { create: [{ roleId: adminRole.id }] } } });
      return { admin: u, role: r };
    });
    balcao = role.id;
    actor = { id: admin.id, name: admin.name } as AuthUser;
    invite = vi.fn();
    republish = vi.fn();
    const directory = { mode: 'control_plane', invite, listMembers: async () => [], getMember: async () => null, removeMember: async () => undefined, sendSetupEmail: async () => true } as unknown as MemberDirectory;
    const limits = { assertActiveUserSlot: async () => undefined, userSeats: async () => ({ max: 10, used: 1 }) };
    service = new AccessService(
      db as never,
      new AccessAudit(db as never),
      limits as never,
      { remove: async () => undefined } as never,
      { publishOrg: republish } as never,
      new PendingInviteService(db as never),
      directory,
    );
  });

  const pending = (email: string): InviteResult => ({ state: 'pending', email });

  it('pessoa nova: o convite fica pendente (sem usuário), com os papéis e auditado; nada é enviado ao control plane de papéis ainda', async () => {
    invite.mockResolvedValue(pending('novo@oficina.com'));
    const r = await run(() => service.invite({ email: 'novo@oficina.com', name: 'Novo', roleIds: [balcao] }, actor));

    expect(r).toMatchObject({ pending: true, userId: null, emailSent: null, accountCreated: true });
    expect(r.sub).toBe(`invite:${r.inviteId}`);
    expect(await run(() => db.user.count({ where: { email: 'novo@oficina.com' } }))).toBe(0);
    expect(await run(() => db.pendingInvite.findMany())).toEqual([expect.objectContaining({ email: 'novo@oficina.com', name: 'Novo', roleIds: [balcao], invitedById: actor.id })]);
    const audit = await run(() => db.accessAuditLog.findMany({ where: { action: 'member.invited' } }));
    expect(audit).toEqual([expect.objectContaining({ targetLabel: 'novo@oficina.com', detail: { roles: ['Balcão'], pending: true } })]);
    expect(republish).not.toHaveBeenCalled(); // ainda não há pessoa para informar papéis
  });

  it('pessoa que já está na organização (`ready`): o usuário nasce na hora com os papéis, e não sobra convite pendente', async () => {
    invite.mockResolvedValue({
      state: 'ready',
      created: false,
      emailSent: false,
      member: { id: 'sub-ana', email: 'ana@oficina.com', name: 'ana@oficina.com', enabled: true, emailVerified: true, pendingActions: [], createdAt: null },
    } satisfies InviteResult);
    const r = await run(() => service.invite({ email: 'ana@oficina.com', name: 'Ana Souza', roleIds: [balcao] }, actor));

    expect(r).toMatchObject({ sub: 'sub-ana', pending: false, inviteId: null, accountCreated: false });
    const user = await run(() => db.user.findFirst({ where: { keycloakId: 'sub-ana' }, include: { roles: true } }));
    expect(user).toMatchObject({ email: 'ana@oficina.com', name: 'Ana Souza', active: true });
    expect(user?.roles.map((x) => x.roleId)).toEqual([balcao]);
    expect(await run(() => db.pendingInvite.count())).toBe(0);
    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('convidar de novo o mesmo e-mail pendente não duplica; quem já tem acesso recebe 409', async () => {
    invite.mockResolvedValue(pending('novo@oficina.com'));
    await run(() => service.invite({ email: 'novo@oficina.com', roleIds: [balcao] }, actor));
    await run(() => service.invite({ email: 'novo@oficina.com', name: 'Novo Nome', roleIds: [balcao] }, actor));
    expect(await run(() => db.pendingInvite.count())).toBe(1);

    await expect(run(() => service.invite({ email: 'admin@oficina.com', roleIds: [balcao] }, actor))).rejects.toMatchObject({ status: 409 });
  });

  it('a lista mostra o convite pendente como "Convidado", com inviteId, e ele some ao cancelar', async () => {
    invite.mockResolvedValue(pending('novo@oficina.com'));
    const r = await run(() => service.invite({ email: 'novo@oficina.com', name: 'Novo', roleIds: [balcao] }, actor));

    const listed = (await run(() => service.members(actor))).members.find((m) => m.email === 'novo@oficina.com');
    expect(listed).toMatchObject({ sub: r.sub, inviteId: r.inviteId, status: 'invited', roleIds: [balcao], name: 'Novo', userId: null, isSelf: false });

    expect(await run(() => service.cancelInvite(r.inviteId!, actor))).toEqual({ id: r.inviteId, cancelled: true });
    expect((await run(() => service.members(actor))).members.find((m) => m.email === 'novo@oficina.com')).toBeUndefined();
  });

  it('o convite pendente não vira ação sobre o sub: trocar papéis dele é 404', async () => {
    invite.mockResolvedValue(pending('novo@oficina.com'));
    const r = await run(() => service.invite({ email: 'novo@oficina.com', roleIds: [balcao] }, actor));
    await expect(run(() => service.setRoles(r.sub, [balcao], actor))).rejects.toMatchObject({ status: 404 });
  });
});
