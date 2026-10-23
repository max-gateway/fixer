import { Injectable } from '@nestjs/common';
import type { Prisma } from '@fixer/db';
import type { AuthUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AccessAction =
  | 'member.invited'
  | 'member.linked'
  | 'member.roles_changed'
  | 'member.deactivated'
  | 'member.reactivated'
  | 'member.removed'
  | 'member.setup_email'
  | 'role.created'
  | 'role.updated'
  | 'role.deleted';

export interface AuditEntry {
  action: AccessAction;
  target: { type: 'member' | 'role'; id: string; label?: string | null };
  detail?: Record<string, unknown>;
}

type Db = Pick<PrismaService, 'accessAuditLog'> | Prisma.TransactionClient;

/** Trilha imutável de quem mudou o quê nos acessos da oficina. Gravada na mesma transação da mudança quando há uma. */
@Injectable()
export class AccessAudit {
  constructor(private readonly prisma: PrismaService) {}

  record(actor: AuthUser | null, entry: AuditEntry, db: Db = this.prisma): Promise<unknown> {
    return db.accessAuditLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? null,
        action: entry.action,
        targetType: entry.target.type,
        targetId: entry.target.id,
        targetLabel: entry.target.label ?? null,
        detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(q: { take: number; cursor?: string; targetId?: string }) {
    const rows = await this.prisma.accessAuditLog.findMany({
      where: q.targetId ? { targetId: q.targetId } : undefined,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: q.take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const more = rows.length > q.take;
    const items = more ? rows.slice(0, q.take) : rows;
    return { items, nextCursor: more ? items[items.length - 1]!.id : null };
  }
}
