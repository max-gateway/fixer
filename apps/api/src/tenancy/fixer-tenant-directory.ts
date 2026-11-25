import type { Membership, TenantDirectory } from '@max-gateway/auth';
import { Injectable, Optional } from '@nestjs/common';
import { PlatformCatalogConfig } from '../catalog-platform/platform-catalog.config.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { MembershipService } from './membership.service.js';

const TTL_MS = 30_000;

/**
 * Registro de tenants do Fixer para o `@max-gateway/auth` (porta `TenantDirectory`): quem participa de qual organização e com que papel
 * da PLATAFORMA. Tanto a participação quanto o papel vêm de `OrgMembership`, que é PROJEÇÃO do control plane (evento `identity.member_ready` e sync do
 * diretório): o control plane é o dono dos papéis de plataforma (docs/specs/control-plane.md). O Fixer só acrescenta o que é dele, o estado ativo ou
 * desativado da pessoa na oficina, e informa ao control plane os papéis que as permissões do Fixer implicam (`PlatformRolesPublisher`). O Fixer só decide
 * onde guardar o registro, nunca como interpretar o token (docs/specs/parts-search-integration.md §4).
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
    // Relógio injetável só nos testes; para o Nest é opcional (sem isso ele tenta resolver `Function` como provider).
    @Optional() private readonly now: () => number = Date.now,
  ) {}

  async membershipsOf(userId: string): Promise<Membership[]> {
    const hit = this.cache.get(userId);
    if (hit && this.now() - hit.at < TTL_MS) return hit.memberships;

    const projected = await this.membership.platformRolesFor(userId);
    const orgs = [...projected.keys()];
    if (orgs.length === 0) return [];

    const users = await this.system.user.findMany({ where: { keycloakId: userId, orgId: { in: orgs } }, select: { orgId: true, active: true } });
    const inactive = new Set(users.filter((u) => !u.active).map((u) => u.orgId.toLowerCase()));
    // Desativado na oficina: continua participando, mas sem papel (nenhum escopo). Os papéis são os projetados do control plane; vínculo ainda não
    // projetado tem lista vazia (fecha por padrão).
    const memberships = orgs.map((orgId): Membership => ({ orgId, roles: inactive.has(orgId) ? [] : (projected.get(orgId) ?? []) }));
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
