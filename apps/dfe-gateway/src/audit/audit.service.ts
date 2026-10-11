import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../db/database.service.js';

/** Quem fez a chamada: o tenant (chave de API) e, quando o produto informa, o usuário final (`X-Actor`). */
export interface Actor {
  tenantId: string;
  tenantSlug: string;
  /** Usuário final no produto; só para auditoria, o gateway não o autentica. */
  user?: string;
  ip?: string;
}

export const actorLabel = (a: Actor): string => (a.user ? `${a.tenantSlug}:${a.user}` : a.tenantSlug);

/** Trilha imutável (trigger no banco proíbe UPDATE/DELETE). Nunca recebe segredo nem XML. */
@Injectable()
export class AuditService {
  constructor(private readonly db: Database) {}

  record(actor: Actor | string, action: string, companyId: string | null, detail: object = {}, client?: PoolClient) {
    const who = typeof actor === 'string' ? actor : actorLabel(actor);
    const ip = typeof actor === 'string' ? null : (actor.ip ?? null);
    const sql = 'INSERT INTO audit_log (actor, action, company_id, detail, ip) VALUES ($1, $2, $3, $4, $5)';
    const params = [who, action, companyId, JSON.stringify(detail), ip];
    return client ? client.query(sql, params) : this.db.query(sql, params);
  }
}
