import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.decorators.js';
import { AccessAudit } from '../access/access-audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PendingInviteView {
  id: string;
  email: string;
  name: string | null;
  roleIds: string[];
  createdAt: Date;
}

/**
 * Convites da tela de acessos que aguardam a identidade da pessoa.
 *
 * O control plane é o dono da pessoa, do vínculo com a organização e da conta no Keycloak, e cria a conta numa fila assíncrona: o `sub` só existe depois,
 * no evento `identity.member_ready`. Os PAPÉIS DA OFICINA, porém, são dado do Fixer (inclusive os personalizados por oficina) e o control plane não os conhece.
 * Este serviço guarda só essa intenção (e-mail → papéis) e a aplica quando a identidade fica pronta: cria o usuário do Fixer com os papéis do convite e apaga o convite.
 *
 * Idempotente (o evento chega pelo menos uma vez) e sempre na organização do contexto (RLS).
 */
@Injectable()
export class PendingInviteService {
  private readonly logger = new Logger(PendingInviteService.name);
  private readonly audit: AccessAudit;

  constructor(private readonly prisma: PrismaService) {
    this.audit = new AccessAudit(prisma);
  }

  /** Registra o convite; convidar de novo o mesmo e-mail atualiza nome e papéis. */
  async upsert(input: { email: string; name?: string; roleIds: string[]; invitedById: string | null }): Promise<PendingInviteView> {
    const email = input.email.trim().toLowerCase();
    const name = input.name?.trim() || null;
    const data = { name, roleIds: [...new Set(input.roleIds)], invitedById: input.invitedById };
    await this.prisma.pendingInvite.createMany({ data: [{ email, ...data }], skipDuplicates: true });
    await this.prisma.pendingInvite.updateMany({ where: { email }, data });
    return this.prisma.pendingInvite.findFirstOrThrow({ where: { email }, select: { id: true, email: true, name: true, roleIds: true, createdAt: true } });
  }

  list(): Promise<PendingInviteView[]> {
    return this.prisma.pendingInvite.findMany({ select: { id: true, email: true, name: true, roleIds: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }

  /** Cancela a intenção do Fixer. A pessoa que o control plane já criou continua na organização, agora sem acesso ao Fixer, e pode ser removida pela lista. */
  async cancel(id: string, actor: AuthUser): Promise<{ id: string; cancelled: boolean }> {
    const invite = await this.prisma.pendingInvite.findFirst({ where: { id }, select: { id: true, email: true } });
    if (!invite) return { id, cancelled: false };
    await this.prisma.$transaction(async (tx) => {
      await tx.pendingInvite.deleteMany({ where: { id } });
      await this.audit.record(actor, { action: 'member.invite_cancelled', target: { type: 'member', id: invite.email, label: invite.email } }, tx);
    });
    return { id, cancelled: true };
  }

  /**
   * A identidade da pessoa ficou pronta: se havia convite, cria (ou reaproveita) o usuário do Fixer com os papéis dele. Papel que foi apagado entre o convite e
   * a identidade é ignorado (não concede nada). Devolve `false` quando não havia convite (a pessoa só entrou na organização).
   */
  async claim(m: { keycloakId: string; email: string }): Promise<boolean> {
    const email = m.email.trim().toLowerCase();
    const invite = await this.prisma.pendingInvite.findFirst({ where: { email }, select: { id: true, name: true, roleIds: true } });
    if (!invite) return false;

    await this.prisma.$transaction(async (tx) => {
      const roles = await tx.role.findMany({ where: { id: { in: invite.roleIds } }, select: { id: true } });
      const roleIds = roles.map((r) => r.id);
      // Pode já existir pelo sub (entrou antes por outro caminho) ou pelo e-mail (desativado): o sub do control plane vence.
      const prior = await tx.user.findFirst({ where: { OR: [{ keycloakId: m.keycloakId }, { email }] }, select: { id: true } });
      const user = prior
        ? await tx.user.update({ where: { id: prior.id }, data: { keycloakId: m.keycloakId, email, active: true }, select: { id: true } })
        : await tx.user.create({ data: { keycloakId: m.keycloakId, email, name: invite.name ?? email, active: true }, select: { id: true } });
      await tx.userRole.deleteMany({ where: { userId: user.id, roleId: { notIn: roleIds } } });
      if (roleIds.length) await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: user.id, roleId })), skipDuplicates: true });
      await tx.pendingInvite.deleteMany({ where: { id: invite.id } });
      await this.audit.record(null, { action: 'member.invite_accepted', target: { type: 'member', id: m.keycloakId, label: email }, detail: { roleIds } }, tx);
    });
    this.logger.log(`Convite aplicado: ${email} entrou na oficina com ${invite.roleIds.length} papel(is).`);
    return true;
  }
}
