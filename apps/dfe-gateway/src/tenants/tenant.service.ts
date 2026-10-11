import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Database } from '../db/database.service.js';

export interface TenantRow {
  id: string;
  slug: string;
  kind: 'FIXER' | 'ROCKET' | 'OTHER';
  status: 'ACTIVE' | 'SUSPENDED';
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/**
 * Chave de API: `dfe_<id>.<segredo>`. O segredo tem 256 bits aleatórios, então um SHA-256 simples basta
 * (não há o que "quebrar por força bruta") e a verificação é barata a cada requisição.
 */
@Injectable()
export class TenantService {
  constructor(private readonly db: Database) {}

  async createTenant(slug: string, kind: TenantRow['kind']): Promise<TenantRow> {
    const { rows } = await this.db.query<TenantRow>('INSERT INTO tenants (slug, kind) VALUES ($1, $2) RETURNING id, slug, kind, status', [slug, kind]);
    return rows[0]!;
  }

  async findBySlug(slug: string): Promise<TenantRow | null> {
    const { rows } = await this.db.query<TenantRow>('SELECT id, slug, kind, status FROM tenants WHERE slug = $1', [slug]);
    return rows[0] ?? null;
  }

  /** Devolve a chave completa UMA vez; no banco fica só o hash. */
  async createApiKey(tenantId: string, label = ''): Promise<{ id: string; key: string }> {
    const id = randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    await this.db.query('INSERT INTO api_keys (id, tenant_id, secret_hash, label) VALUES ($1, $2, $3, $4)', [id, tenantId, sha256(secret), label]);
    return { id, key: `dfe_${id}.${secret}` };
  }

  async revokeApiKey(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
    return (rowCount ?? 0) > 0;
  }

  /** Resolve a chave para o tenant ativo, ou null. Comparação em tempo constante. */
  async authenticate(presented: string): Promise<TenantRow | null> {
    const m = /^dfe_([0-9a-f]{12})\.([A-Za-z0-9_-]{20,})$/.exec(presented);
    if (!m) return null;
    const { rows } = await this.db.query<TenantRow & { secret_hash: Buffer }>(
      `SELECT t.id, t.slug, t.kind, t.status, k.secret_hash
         FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
        WHERE k.id = $1 AND k.revoked_at IS NULL`,
      [m[1]],
    );
    const row = rows[0];
    const expected = row?.secret_hash;
    const given = sha256(m[2]!);
    // Compara sempre, mesmo sem linha, para não vazar por tempo se a chave existe.
    const ok = expected && expected.length === given.length && timingSafeEqual(expected, given);
    if (!row || !ok || row.status !== 'ACTIVE') return null;
    void this.db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [m[1]]).catch(() => undefined);
    return { id: row.id, slug: row.slug, kind: row.kind, status: row.status };
  }
}
