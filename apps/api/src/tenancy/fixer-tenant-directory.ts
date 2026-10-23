import type { Membership, TenantDirectory } from '@max-gateway/auth';
import { Injectable } from '@nestjs/common';
import { PlatformCatalogConfig } from '../catalog-platform/platform-catalog.config.js';
import { platformRolesFor } from '../catalog-platform/platform-roles.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { MembershipService } from './membership.service.js';

const TTL_MS = 30_000;

/**
 * Registro de tenants do Fixer para o `@max-gateway/auth` (porta `TenantDirectory`): quem participa de qual organização e com que papel
 * da PLATAFORMA. A participação vem de `OrgMembership` (alimentada pelos eventos de identidade do control plane); o papel é derivado das
 * permissões de negócio que a pessoa tem em cada organização (`platformRolesFor`). O Fixer só decide onde guardar o registro, nunca como
 * interpretar o token (docs/specs/parts-search-integration.md §4).
 *
 * Atravessa organizações, então usa o cliente de sistema (sem RLS) e consulta só as organizações do próprio usuário. Cache curto por
 * usuário: uma mudança de papel chega às chamadas à plataforma em até 30 s (a autorização das rotas do próprio Fixer lê o banco a cada requisição).
 */
@Injectable()
export class FixerTenantDirectory implements TenantDirectory {
  private readonly cache = new Map<string, { at: number; memberships: Membership[] }>();

  constructor(
    private readonly system: SystemPrismaService,
    private readonly membership: MembershipService,
    private readonly config: PlatformCatalogConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async membershipsOf(userId: string): Promise<Membership[]> {
    const hit = this.cache.get(userId);
    if (hit && this.now() - hit.at < TTL_MS) return hit.memberships;

    const orgs = [...new Set((await this.membership.orgsFor(userId)).map((o) => o.toLowerCase()))];
    if (orgs.length === 0) return [];

    const users = await this.system.user.findMany({
      where: { keycloakId: userId, orgId: { in: orgs } },
      select: { orgId: true, active: true, roles: { select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } } },
    });
    const byOrg = new Map(users.map((u) => [u.orgId.toLowerCase(), u]));
    const memberships = orgs.map((orgId): Membership => {
      const user = byOrg.get(orgId);
      // Desativado: continua participando, mas sem papel (nenhum escopo). Sem usuário ainda (convidado que não entrou): só consulta.
      if (user && !user.active) return { orgId, roles: [] };
      const keys = user?.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)) ?? [];
      return { orgId, roles: platformRolesFor(keys) };
    });
    this.cache.set(userId, { at: this.now(), memberships });
    return memberships;
  }

  /** O Fixer não tem o conceito de loja: cada organização tem uma loja implícita, com o próprio id da organização. */
  async storesOf(orgId: string): Promise<string[]> {
    return [orgId.toLowerCase()];
  }

  async catalogsOf(_orgId: string): Promise<string[]> {
    return [...this.config.catalogs];
  }
}
