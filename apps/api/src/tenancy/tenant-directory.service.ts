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
