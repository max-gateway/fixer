import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { isValidCnpj, normalizeCnpj } from '../core/cnpj.js';
import { Database } from '../db/database.service.js';

export interface CompanyRow {
  id: string;
  cnpj: string;
  owner_id: string;
  legal_name: string | null;
  uf_code: number | null;
}

export const CompanyBodySchema = z.object({
  legalName: z.string().trim().min(1).max(200).optional(),
  ufCode: z.number().int().min(11).max(53).optional(),
});

/** Valida o CNPJ do caminho (14 posições, alfanumérico, dígitos verificadores). */
export function parseCnpj(raw: string): string {
  const cnpj = normalizeCnpj(raw);
  if (!isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido');
  return cnpj;
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cria ou atualiza a empresa. Um CNPJ tem UM dono em todo o gateway (D1): quem não é o dono recebe 409 sem
   * saber de quem é. Para dividir o CNPJ, o dono concede acesso (`grant` no CLI) e o outro vira assinante.
   */
  async upsert(actor: Actor, cnpj: string, body: z.infer<typeof CompanyBodySchema>): Promise<CompanyRow> {
    return this.db.tx(async (c) => {
      const existing = (await c.query<CompanyRow>('SELECT * FROM companies WHERE cnpj = $1 FOR UPDATE', [cnpj])).rows[0];
      if (existing && existing.owner_id !== actor.tenantId) {
        throw new ConflictException('Este CNPJ já está em uso por outro cliente do gateway');
      }
      if (existing) {
        const { rows } = await c.query<CompanyRow>(
          'UPDATE companies SET legal_name = COALESCE($2, legal_name), uf_code = COALESCE($3, uf_code) WHERE id = $1 RETURNING *',
          [existing.id, body.legalName ?? null, body.ufCode ?? null],
        );
        return rows[0]!;
      }
      const { rows } = await c.query<CompanyRow>(
        'INSERT INTO companies (cnpj, owner_id, legal_name, uf_code) VALUES ($1, $2, $3, $4) RETURNING *',
        [cnpj, actor.tenantId, body.legalName ?? null, body.ufCode ?? null],
      );
      const company = rows[0]!;
      await c.query('INSERT INTO sync_state (company_id) VALUES ($1)', [company.id]);
      // O dono recebe os documentos por padrão, em modo PULL (cursor), até escolher um transporte.
      await c.query('INSERT INTO subscriptions (company_id, tenant_id) VALUES ($1, $2)', [company.id, actor.tenantId]);
      await this.audit.record(actor, 'company.create', company.id, { cnpj }, c);
      return company;
    });
  }

  /** Empresa do tenant (dono). Qualquer outro caso é 404: nunca revela que o CNPJ existe. */
  async requireOwned(actor: Actor, cnpj: string): Promise<CompanyRow> {
    const { rows } = await this.db.query<CompanyRow>('SELECT * FROM companies WHERE cnpj = $1 AND owner_id = $2', [cnpj, actor.tenantId]);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada');
    return rows[0];
  }

  /** Empresa que o tenant pode LER: é o dono ou tem assinatura. */
  async requireReadable(actor: Actor, cnpj: string): Promise<CompanyRow> {
    const { rows } = await this.db.query<CompanyRow>(
      `SELECT c.* FROM companies c
        WHERE c.cnpj = $1
          AND (c.owner_id = $2 OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id AND s.tenant_id = $2))`,
      [cnpj, actor.tenantId],
    );
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada');
    return rows[0];
  }

  async status(company: CompanyRow) {
    const [cred, state, subs] = await Promise.all([
      this.db.query(
        `SELECT environment, subject, cert_cnpj, not_before, not_after, status, enabled, auto_manifest, updated_at
           FROM credentials WHERE company_id = $1`,
        [company.id],
      ),
      this.db.query(
        `SELECT last_nsu::text, max_nsu::text, next_poll_at, last_status_code, last_error, last_run_at, last_success_at, consecutive_failures
           FROM sync_state WHERE company_id = $1`,
        [company.id],
      ),
      this.db.query(
        `SELECT t.slug AS tenant, s.transport, s.status, s.acked_nsu::text AS acked_nsu
           FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.company_id = $1`,
        [company.id],
      ),
    ]);
    return {
      cnpj: company.cnpj,
      legalName: company.legal_name,
      ufCode: company.uf_code,
      credential: cred.rows[0] ?? null,
      sync: state.rows[0] ?? null,
      subscriptions: subs.rows,
    };
  }
}
