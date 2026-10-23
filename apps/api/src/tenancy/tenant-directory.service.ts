import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

/**
 * Descobre a organização dona de algo que chega SEM sessão de usuário (link público do portal, código de WhatsApp) e
 * quais organizações têm trabalho para os agendadores. Só devolve ids de organização: o trabalho em si é feito
 * pelo PrismaService dentro de `TenantContext.run(orgId, ...)`.
 */
@Injectable()
export class TenantDirectory {
  constructor(private readonly system: SystemPrismaService) {}

  async orgForPortalToken(token: string): Promise<string | null> {
    if (!token || token.length > 128) return null;
    const row = await this.system.serviceOrder.findUnique({ where: { portalToken: token }, select: { orgId: true } });
    return row?.orgId ?? null;
  }

  async orgForLinkCode(code: string): Promise<string | null> {
    const row = await this.system.serviceOrder.findUnique({ where: { linkCode: code }, select: { orgId: true } });
    return row?.orgId ?? null;
  }

  /** Organizações com papel Admin de sistema (alvo da ressincronização de permissões no boot). */
  async orgsWithAdminRole(): Promise<string[]> {
    const rows = await this.system.role.findMany({ where: { name: 'Admin', isSystem: true }, select: { orgId: true } });
    return rows.map((r) => r.orgId);
  }

  /** Organizações com certificado fiscal habilitado (alvo dos agendadores de NF-e). */
  async orgsWithFiscalCredential(): Promise<string[]> {
    const rows = await this.system.fiscalCredential.findMany({ where: { enabled: true }, select: { orgId: true } });
    return rows.map((r) => r.orgId);
  }

  /** Organizações com sincronização fiscal pronta para rodar agora (próximo poll vencido e sem lease ativo). */
  async orgsDueForFiscalSync(now: Date = new Date()): Promise<string[]> {
    const rows = await this.system.fiscalSyncState.findMany({
      where: {
        nextPollAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        credential: { enabled: true },
      },
      select: { orgId: true },
    });
    return rows.map((r) => r.orgId);
  }

  /**
   * Organizações que autorizaram a leitura dos dados de imposto na Receita, com o regime e as tentativas de atualização
   * recentes (auditoria `autofill.refresh.*`). Quem decide se está na hora é o agendador (função pura, testada sem banco).
   */
  async taxRefreshCandidates(since: Date): Promise<{ orgId: string; actorId: string; regime: string | null; attempts: { action: string; at: Date }[] }[]> {
    const creds = await this.system.fiscalCredential.findMany({
      where: { taxDataConsent: true, taxDataConsentById: { not: null } },
      select: { orgId: true, taxDataConsentById: true },
    });
    if (creds.length === 0) return [];
    const orgIds = creds.map((c) => c.orgId);
    const [settings, audits] = await Promise.all([
      this.system.tenantFiscalSettings.findMany({ where: { orgId: { in: orgIds } }, select: { orgId: true, taxRegime: true } }),
      this.system.fiscalAuditLog.findMany({ where: { orgId: { in: orgIds }, action: { startsWith: 'autofill.refresh.' }, at: { gte: since } }, select: { orgId: true, action: true, at: true } }),
    ]);
    return creds.map((c) => ({
      orgId: c.orgId,
      actorId: c.taxDataConsentById!,
      regime: settings.find((x) => x.orgId === c.orgId)?.taxRegime ?? null,
      attempts: audits.filter((a) => a.orgId === c.orgId).map((a) => ({ action: a.action, at: a.at })),
    }));
  }

  /** Organizações com notas aguardando a Ciência da Operação. */
  async orgsWithPendingManifest(now: Date = new Date()): Promise<string[]> {
    const rows = await this.system.purchaseInvoice.findMany({
      where: { status: 'SUMMARY', OR: [{ manifestNextAt: null }, { manifestNextAt: { lte: now } }] },
      select: { orgId: true },
      distinct: ['orgId'],
    });
    return rows.map((r) => r.orgId);
  }
}
