import type { DirectoryStore } from '@max-gateway/directory-sync';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

/** Origem dos vínculos que o sync administra. Convites feitos pela tela de acessos do Fixer ficam `local` e o sync nunca os remove. */
const SOURCE = 'control_plane';

/**
 * Registro de organizações e membros do Fixer (`OrgProfile` e `OrgMembership`) a partir do diretório do control plane
 * (`@max-gateway/directory-sync`). Atravessa organizações por natureza, então usa o cliente de sistema (ignora RLS), como o `MembershipService.orgsFor`.
 */
export class FixerDirectoryStore implements DirectoryStore {
  constructor(private readonly system: Pick<SystemPrismaService, 'orgProfile' | 'orgMembership'>) {}

  async upsertOrg(orgId: string, name: string): Promise<void> {
    await this.system.orgProfile.upsert({ where: { orgId }, update: { name }, create: { orgId, name } });
  }

  async upsertMember(orgId: string, sub: string, role: string, email: string | null): Promise<void> {
    const mail = email ?? '';
    await this.system.orgMembership.upsert({
      where: { orgId_keycloakId: { orgId, keycloakId: sub } },
      // Não apaga o e-mail que já existe se o control plane não mandou um.
      update: { role, source: SOURCE, ...(mail ? { email: mail } : {}) },
      create: { orgId, keycloakId: sub, email: mail, role, source: SOURCE },
    });
  }

  async memberSubsOf(orgId: string): Promise<string[]> {
    const rows = await this.system.orgMembership.findMany({ where: { orgId, source: SOURCE }, select: { keycloakId: true } });
    return rows.map((r) => r.keycloakId);
  }

  async removeMembers(orgId: string, subs: string[]): Promise<number> {
    if (subs.length === 0) return 0;
    const r = await this.system.orgMembership.deleteMany({ where: { orgId, source: SOURCE, keycloakId: { in: subs } } });
    return r.count;
  }

  async orgIds(): Promise<string[]> {
    const rows = await this.system.orgProfile.findMany({ select: { orgId: true } });
    return rows.map((r) => r.orgId);
  }

  async countMembers(): Promise<number> {
    return this.system.orgMembership.count({ where: { source: SOURCE } });
  }
}
