import { Injectable } from '@nestjs/common';
import type { Membership, TenantDirectory as PlatformDirectory } from '@max-gateway/auth';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { TenantContext } from './tenant-context.js';

const TTL_MS = 30_000;

/**
 * Participação de usuários em organizações. A fonte são os eventos de identidade do control plane (`identity.member_ready`):
 * o claim `organization` do token é só um atalho, porque o Keycloak 26.0 o omite ao acaso para quem está em várias organizações.
 * Escrever (`record`) é por organização, sujeito a RLS; descobrir as organizações de um usuário atravessa todas e usa o cliente de sistema.
 */
@Injectable()
export class MembershipService implements PlatformDirectory {
  private readonly cache = new Map<string, { orgs: string[]; at: number }>();
  private readonly roleCache = new Map<string, { memberships: Membership[]; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrismaService,
  ) {}

  /** Organizações em que o `sub` participa, com cache curto por réplica. Falha de banco não derruba o login: cai para o claim. */
  async orgsFor(sub: string | undefined): Promise<string[]> {
    if (!sub) return [];
    const hit = this.cache.get(sub);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.orgs;
    try {
      const rows = await this.system.orgMembership.findMany({ where: { keycloakId: sub }, select: { orgId: true } });
      const orgs = rows.map((r) => r.orgId.toLowerCase());
      this.cache.set(sub, { orgs, at: Date.now() });
      return orgs;
    } catch {
      return hit?.orgs ?? [];
    }
  }

  /**
   * Porta `TenantDirectory` do `@max-gateway/auth` (spec §7.2): pertencimento e papel por organização vêm DAQUI (registro do Fixer, alimentado
   * pelo control plane), nunca do token. Falha do banco sobe (o pacote responde 503): nem "sem acesso" nem "com acesso" por engano; só um
   * registro recém-lido (dentro do TTL) ou o último conhecido substitui a leitura.
   */
  async membershipsOf(sub: string): Promise<Membership[]> {
    const hit = this.roleCache.get(sub);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.memberships;
    const rows = await this.system.orgMembership.findMany({ where: { keycloakId: sub }, select: { orgId: true, role: true } });
    const memberships = rows.map((r) => ({ orgId: r.orgId.toLowerCase(), roles: r.role ? [r.role] : [] }));
    this.roleCache.set(sub, { memberships, at: Date.now() });
    return memberships;
  }

  /** O Fixer não tem lojas nem catálogos compartilhados na plataforma ainda (G15, P6). */
  async storesOf(): Promise<string[]> {
    return [];
  }

  async catalogsOf(): Promise<string[]> {
    return [];
  }

  /** Grava (ou atualiza) a participação na organização do contexto. Idempotente e atômico (eventos chegam repetidos e em paralelo). */
  async record(m: { keycloakId: string; email: string; role: string }): Promise<void> {
    const data = { email: m.email.toLowerCase(), role: m.role };
    await this.prisma.orgMembership.createMany({ data: [{ keycloakId: m.keycloakId, ...data }], skipDuplicates: true });
    await this.prisma.orgMembership.updateMany({ where: { keycloakId: m.keycloakId }, data });
    this.cache.delete(m.keycloakId);
    this.roleCache.delete(m.keycloakId); // a próxima requisição enxerga a organização nova na hora
  }

  /** Remove a participação na organização do contexto (futuro: evento de remoção de membro). */
  async remove(keycloakId: string): Promise<void> {
    await this.prisma.orgMembership.deleteMany({ where: { keycloakId } });
    this.cache.delete(keycloakId);
    this.roleCache.delete(keycloakId);
  }

  /** Só para a organização do contexto: usado pelos testes e pela checagem pontual. */
  async isMember(keycloakId: string): Promise<boolean> {
    return (await this.prisma.orgMembership.count({ where: { orgId: TenantContext.require(), keycloakId } })) > 0;
  }
}
