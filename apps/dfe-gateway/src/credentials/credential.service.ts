import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, AuditService, actorLabel } from '../audit/audit.service.js';
import type { CompanyRow } from '../companies/company.service.js';
import { cnpjBase } from '../core/cnpj.js';
import type { KeyProvider } from '../core/crypto/key-provider.js';
import { open, seal } from '../core/crypto/secret-box.js';
import { parsePfx, PfxError, type ParsedPfx } from '../core/pfx.js';
import type { CredentialMaterial } from '../core/sefaz/dfe-source.js';
import { Database } from '../db/database.service.js';

export const KEY_PROVIDER = Symbol('DFE_KEY_PROVIDER');

const CTX_PFX = 'dfe-credential:pfx';
const CTX_PASS = 'dfe-credential:pfx-pass';
/** O certificado precisa valer por pelo menos isto; evita aceitar um que vence antes do primeiro ciclo. */
const MIN_VALID_DAYS = 7;
const MAX_PFX_BYTES = 256 * 1024;

export const InspectSchema = z.object({
  pfxBase64: z.string().min(1, 'Envie o arquivo .pfx em base64'),
  password: z.string().min(1, 'Informe a senha do certificado'),
});

export const UploadSchema = InspectSchema.extend({
  environment: z.enum(['PRODUCTION', 'HOMOLOGATION']).default('PRODUCTION'),
});

export const FlagsSchema = z
  .object({
    enabled: z.boolean(),
    autoManifest: z.boolean(),
    /**
     * Ciente de que a Ciência da Operação automática cria o dever de registrar depois a manifestação
     * conclusiva em até 180 dias (NT 2020.001, item 2.D). Exigido para ligar `autoManifest`; só é auditado.
     */
    acknowledgeManifestDuty: z.boolean(),
  })
  .partial()
  .refine((v) => v.enabled !== undefined || v.autoManifest !== undefined, 'Nada para atualizar')
  .refine((v) => v.autoManifest !== true || v.acknowledgeManifestDuty === true, 'Para ligar a ciência automática, confirme acknowledgeManifestDuty');

interface CredentialRow {
  environment: 'PRODUCTION' | 'HOMOLOGATION';
  pfx_ciphertext: Buffer;
  pfx_pass_ciphertext: Buffer;
  key_id: string;
}

/** Cofre dos certificados A1: o .pfx e a senha só existem cifrados (envelope AES-256-GCM) fora da memória do worker. */
@Injectable()
export class CredentialService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
  ) {}

  /** Abre o .pfx só para ler titular e CNPJ (cadastro guiado). Não grava nada. */
  inspect(input: z.infer<typeof InspectSchema>) {
    const { subject, certCnpj, notBefore, notAfter } = this.parse(this.decode(input.pfxBase64), input.password);
    return { subject, certCnpj, notBefore, notAfter };
  }

  async upload(actor: Actor, company: CompanyRow, input: z.infer<typeof UploadSchema>) {
    this.requireKeys();
    const parsed = this.parse(this.decode(input.pfxBase64), input.password);
    if (cnpjBase(parsed.certCnpj) !== cnpjBase(company.cnpj)) {
      throw new BadRequestException('O CNPJ do certificado não pertence à mesma raiz do CNPJ da empresa');
    }
    const now = Date.now();
    if (parsed.notAfter.getTime() < now) throw new BadRequestException('Certificado vencido');
    if (parsed.notAfter.getTime() - now < MIN_VALID_DAYS * 86_400_000) {
      throw new BadRequestException(`Certificado vence em menos de ${MIN_VALID_DAYS} dias`);
    }
    if (parsed.notBefore.getTime() > now) throw new BadRequestException('Certificado ainda não é válido');

    const pfx = this.decode(input.pfxBase64);
    const sealedPfx = await seal(this.keys, pfx, CTX_PFX);
    const sealedPass = await seal(this.keys, Buffer.from(input.password, 'utf8'), CTX_PASS);

    // Reenvio (renovação) preserva `enabled`/`auto_manifest` e o NSU (que mora em sync_state).
    await this.db.query(
      `INSERT INTO credentials (company_id, environment, pfx_ciphertext, pfx_pass_ciphertext, key_id, subject, cert_cnpj, not_before, not_after, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (company_id) DO UPDATE SET
         environment = EXCLUDED.environment, pfx_ciphertext = EXCLUDED.pfx_ciphertext,
         pfx_pass_ciphertext = EXCLUDED.pfx_pass_ciphertext, key_id = EXCLUDED.key_id, subject = EXCLUDED.subject,
         cert_cnpj = EXCLUDED.cert_cnpj, not_before = EXCLUDED.not_before, not_after = EXCLUDED.not_after,
         uploaded_by = EXCLUDED.uploaded_by, status = 'ACTIVE', version = credentials.version + 1, updated_at = now()`,
      [company.id, input.environment, sealedPfx.blob, sealedPass.blob, sealedPfx.keyId, parsed.subject, parsed.certCnpj, parsed.notBefore, parsed.notAfter, actorLabel(actor)],
    );
    await this.audit.record(actor, 'credential.upload', company.id, { subject: parsed.subject, certCnpj: parsed.certCnpj, notAfter: parsed.notAfter, environment: input.environment });
    return { subject: parsed.subject, certCnpj: parsed.certCnpj, notBefore: parsed.notBefore, notAfter: parsed.notAfter, environment: input.environment };
  }

  async updateFlags(actor: Actor, company: CompanyRow, flags: z.infer<typeof FlagsSchema>) {
    const { rows } = await this.db.query(
      `UPDATE credentials SET enabled = COALESCE($2, enabled), auto_manifest = COALESCE($3, auto_manifest), updated_at = now()
        WHERE company_id = $1 RETURNING enabled, auto_manifest`,
      [company.id, flags.enabled ?? null, flags.autoManifest ?? null],
    );
    if (!rows[0]) throw new NotFoundException('Nenhum certificado cadastrado');
    await this.audit.record(actor, 'credential.flags', company.id, flags);
    return { enabled: rows[0].enabled as boolean, autoManifest: rows[0].auto_manifest as boolean };
  }

  /** Remove só o certificado: o NSU e os documentos ficam (o histórico da empresa é dela, não do certificado). */
  async remove(actor: Actor, company: CompanyRow) {
    const { rowCount } = await this.db.query('DELETE FROM credentials WHERE company_id = $1', [company.id]);
    if (!rowCount) throw new NotFoundException('Nenhum certificado cadastrado');
    await this.audit.record(actor, 'credential.delete', company.id);
  }

  /** Decifra o certificado para uma rodada. O retorno vive só na memória do chamador. */
  async openMaterial(companyId: string): Promise<CredentialMaterial> {
    this.requireKeys();
    const { rows } = await this.db.query<CredentialRow>(
      'SELECT environment, pfx_ciphertext, pfx_pass_ciphertext, key_id FROM credentials WHERE company_id = $1',
      [companyId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Nenhum certificado cadastrado');
    const pfx = await open(this.keys, row.key_id, row.pfx_ciphertext, CTX_PFX);
    const password = (await open(this.keys, row.key_id, row.pfx_pass_ciphertext, CTX_PASS)).toString('utf8');
    return { ...parsePfx(pfx, password), environment: row.environment };
  }

  private decode(b64: string): Buffer {
    const pfx = Buffer.from(b64, 'base64');
    if (pfx.length === 0 || pfx.length > MAX_PFX_BYTES) throw new BadRequestException('Arquivo .pfx inválido ou grande demais');
    return pfx;
  }

  private parse(pfx: Buffer, password: string): ParsedPfx {
    try {
      return parsePfx(pfx, password);
    } catch (err) {
      if (err instanceof PfxError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private requireKeys(): void {
    if (!this.keys.available) throw new ServiceUnavailableException('Chave de criptografia do gateway não configurada');
  }
}
