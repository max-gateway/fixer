import { Injectable } from '@nestjs/common';
import { ADMIN_ROLE, PERMISSIONS } from '../auth/permissions.catalog.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';

const PROFILE_TTL_MS = 60_000;

/**
 * Cria o que uma organização nova precisa para ser usável. Tudo idempotente (eventos chegam pelo menos uma vez e
 * fora de ordem). O dono não existe em `User` até o primeiro login, então ele vira Admin NO LOGIN (`ensureOwnerAdmin`).
 */
@Injectable()
export class ProvisioningService {
  private readonly owners = new Map<string, { email: string | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Grava os dados da organização (se vierem) e garante o papel Admin com todas as permissões. */
  async provision(profile: { slug?: string | null; name?: string | null; ownerEmail?: string | null } = {}): Promise<void> {
    const orgId = TenantContext.require();
    if (profile.slug || profile.name || profile.ownerEmail) {
      const data = {
        ...(profile.slug ? { slug: profile.slug } : {}),
        ...(profile.name ? { name: profile.name } : {}),
        ...(profile.ownerEmail ? { ownerEmail: profile.ownerEmail.toLowerCase() } : {}),
      };
      // Insere se não existe (atômico, sem colidir com um evento simultâneo) e depois atualiza com o que veio.
      await this.prisma.orgProfile.createMany({ data: [data], skipDuplicates: true });
      await this.prisma.orgProfile.update({ where: { orgId }, data });
      this.owners.delete(orgId);
    }
    await this.ensureAdminRole();
  }

  /** Papel Admin da organização com todas as permissões do catálogo. */
  async ensureAdminRole(): Promise<string> {
    const orgId = TenantContext.require();
    // Eventos da mesma organização (e de várias ao mesmo tempo) chegam em paralelo. `upsert` do Prisma NÃO é atômico aqui: duas
    // chamadas simultâneas colidem na unicidade. `createMany` + `skipDuplicates` vira INSERT ... ON CONFLICT DO NOTHING (atômico).
    await this.prisma.permission.createMany({ data: PERMISSIONS.map((p) => ({ key: p.key, label: p.label })), skipDuplicates: true });
    await this.prisma.role.createMany({ data: [{ name: ADMIN_ROLE, description: 'Acesso total', isSystem: true }], skipDuplicates: true });
    const role = await this.prisma.role.findUniqueOrThrow({ where: { orgId_name: { orgId, name: ADMIN_ROLE } }, select: { id: true } });
    const perms = await this.prisma.permission.findMany({ where: { key: { in: PERMISSIONS.map((p) => p.key) } }, select: { id: true } });
    await this.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true });
    return role.id;
  }

  /**
   * Chamado a cada login. Se o e-mail é o do dono cadastrado pelo control plane e o usuário ainda não tem papel nenhum,
   * ele vira Admin. Só age uma vez (depois de ter papel, nada muda), então um dono rebaixado de propósito não volta sozinho.
   */
  async ensureOwnerAdmin(user: { id: string; email: string }): Promise<boolean> {
    const orgId = TenantContext.require();
    if ((await this.ownerEmail(orgId)) !== user.email.toLowerCase()) return false;
    if ((await this.prisma.userRole.count({ where: { userId: user.id } })) > 0) return false;
    const roleId = await this.ensureAdminRole();
    await this.prisma.userRole.createMany({ data: [{ userId: user.id, roleId }], skipDuplicates: true });
    return true;
  }

  private async ownerEmail(orgId: string): Promise<string | null> {
    const hit = this.owners.get(orgId);
    if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.email;
    const p = await this.prisma.orgProfile.findUnique({ where: { orgId }, select: { ownerEmail: true } });
    this.owners.set(orgId, { email: p?.ownerEmail ?? null, at: Date.now() });
    return p?.ownerEmail ?? null;
  }
}
