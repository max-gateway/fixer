import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { CredentialService, UploadSchema } from '../credentials/credential.service.js';
import { Database } from '../db/database.service.js';
import { CompanyBodySchema, CompanyService } from './company.service.js';

export const RegistrationSchema = CompanyBodySchema.extend({
  /** Certificado A1. Omitido = só atualiza empresa/flags (ex.: o reconciliador do produto, que não reenvia o .pfx). */
  credential: UploadSchema.optional(),
  /** Liga/desliga a sincronização. Omitido = mantém (e um certificado novo começa desligado). */
  enabled: z.boolean().optional(),
  autoManifest: z.boolean().optional(),
  /** Ciente do dever de manifestação conclusiva em até 180 dias (NT 2020.001, 2.D). Exigido para `autoManifest: true`. */
  acknowledgeManifestDuty: z.boolean().optional(),
  /** NSU que o produto já consumiu antes de migrar. Só vale se o gateway ainda está em zero. */
  resumeFromNsu: z.string().regex(/^\d{1,18}$/, 'resumeFromNsu deve ser numérico').optional(),
}).refine((v) => v.autoManifest !== true || v.acknowledgeManifestDuty === true, {
  message: 'Para ligar a ciência automática, confirme acknowledgeManifestDuty',
  path: ['acknowledgeManifestDuty'],
});

/** Cadastro de uma empresa na Distribuição DF-e, de uma vez e de forma idempotente (spec §6.2). */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly companies: CompanyService,
    private readonly credentials: CredentialService,
  ) {}

  async register(actor: Actor, cnpj: string, body: z.infer<typeof RegistrationSchema>) {
    // 409 se outro cliente já é dono do CNPJ; só o dono passa daqui.
    const company = await this.companies.upsert(actor, cnpj, { legalName: body.legalName, ufCode: body.ufCode });

    const certificate = body.credential ? await this.credentials.register(actor, company, body.credential) : { changed: false };

    if (body.enabled !== undefined || body.autoManifest !== undefined) {
      const has = await this.db.query('SELECT 1 FROM credentials WHERE company_id = $1', [company.id]);
      if (!has.rowCount) throw new BadRequestException('Envie o certificado antes de ligar a sincronização');
      await this.credentials.updateFlags(actor, company, {
        enabled: body.enabled,
        autoManifest: body.autoManifest,
        acknowledgeManifestDuty: body.acknowledgeManifestDuty,
      });
    }

    // Retomada só com o NSU zerado: reenviar o cadastro depois nunca faz o cursor voltar nem andar.
    let resumed = false;
    if (body.resumeFromNsu && BigInt(body.resumeFromNsu) > 0n) {
      const r = await this.db.query('UPDATE sync_state SET last_nsu = $2 WHERE company_id = $1 AND last_nsu = 0', [company.id, body.resumeFromNsu]);
      resumed = (r.rowCount ?? 0) > 0;
    }

    if (certificate.changed || resumed) {
      await this.audit.record(actor, 'company.register', company.id, { credentialChanged: certificate.changed, resumed });
    }
    return { ...(await this.companies.status(company)), changed: { credential: certificate.changed, resumed } };
  }
}
