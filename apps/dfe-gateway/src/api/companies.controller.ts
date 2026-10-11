import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { CompanyBodySchema, CompanyService, parseCnpj } from '../companies/company.service.js';
import { RegistrationSchema, RegistrationService } from '../companies/registration.service.js';
import { CredentialService, FlagsSchema, InspectSchema, UploadSchema } from '../credentials/credential.service.js';
import { Database } from '../db/database.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { AckSchema, SubscriptionSchema, SubscriptionService } from '../subscriptions/subscription.service.js';
import { AuthGuard, CurrentActor } from '../tenants/auth.guard.js';

const ResumeSchema = z.object({ nsu: z.string().regex(/^\d{1,18}$/, 'nsu deve ser numérico') });
const ManifestSchema = z.object({
  type: z.literal('CIENCIA').default('CIENCIA'),
  accessKeys: z.array(z.string().regex(/^[A-Z0-9]{43}[0-9]$/, 'chave de acesso inválida')).min(1).max(200),
});
const ListQuery = z.object({
  afterNsu: z.string().regex(/^\d{1,18}$/).default('0'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const KEY_RE = /^[A-Z0-9]{43}[0-9]$/;

/**
 * API pública `/v1` (docs/specs/dfe-gateway.md §6). Toda rota exige a chave de API do tenant; um recurso de
 * outro tenant responde 404 (nunca 403), para não revelar que existe.
 */
@Controller('v1/companies/:cnpj')
@UseGuards(AuthGuard)
export class CompaniesController {
  constructor(
    private readonly db: Database,
    private readonly companies: CompanyService,
    private readonly credentials: CredentialService,
    private readonly documents: DocumentsService,
    private readonly subscriptions: SubscriptionService,
    private readonly audit: AuditService,
    private readonly registration: RegistrationService,
  ) {}

  @Put()
  async upsert(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const company = await this.companies.upsert(actor, parseCnpj(cnpj), CompanyBodySchema.parse(body ?? {}));
    return this.companies.status(company);
  }

  /**
   * Cadastro completo e IDEMPOTENTE, em uma chamada: empresa + certificado + flags + retomada do NSU. É o que os
   * produtos chamam ao salvar (spec §6.2). As regras (instalar só se mudou, consentimento da ciência automática,
   * retomar só com NSU zerado) moram AQUI, não em cada produto.
   */
  @Put('registration')
  async register(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.registration.register(actor, parseCnpj(cnpj), RegistrationSchema.parse(body ?? {}));
  }

  @Get()
  async get(@Param('cnpj') cnpj: string, @CurrentActor() actor: Actor) {
    return this.companies.status(await this.companies.requireReadable(actor, parseCnpj(cnpj)));
  }

  // --- certificado (só o dono) ---------------------------------------------------------------------------

  @Post('credential/inspect')
  @HttpCode(200)
  async inspect(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    await this.companies.requireOwned(actor, parseCnpj(cnpj));
    return this.credentials.inspect(InspectSchema.parse(body));
  }

  @Put('credential')
  async upload(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireOwned(actor, parseCnpj(cnpj));
    return this.credentials.upload(actor, company, UploadSchema.parse(body));
  }

  @Patch('credential')
  async flags(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireOwned(actor, parseCnpj(cnpj));
    return this.credentials.updateFlags(actor, company, FlagsSchema.parse(body));
  }

  @Delete('credential')
  @HttpCode(204)
  async remove(@Param('cnpj') cnpj: string, @CurrentActor() actor: Actor) {
    await this.credentials.remove(actor, await this.companies.requireOwned(actor, parseCnpj(cnpj)));
  }

  // --- documentos (dono ou assinante) --------------------------------------------------------------------

  @Get('documents')
  async list(@Param('cnpj') cnpj: string, @Query() query: unknown, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireReadable(actor, parseCnpj(cnpj));
    const q = ListQuery.parse(query);
    return this.documents.list(company.id, BigInt(q.afterNsu), q.limit);
  }

  @Get('documents/:accessKey')
  async byKey(@Param('cnpj') cnpj: string, @Param('accessKey') accessKey: string, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireReadable(actor, parseCnpj(cnpj));
    if (!KEY_RE.test(accessKey)) throw new BadRequestException('Chave de acesso inválida');
    return this.documents.byAccessKey(company.id, accessKey);
  }

  // --- assinatura -----------------------------------------------------------------------------------------

  @Get('subscription')
  async getSubscription(@Param('cnpj') cnpj: string, @CurrentActor() actor: Actor) {
    return this.subscriptions.get(actor, await this.companies.requireReadable(actor, parseCnpj(cnpj)));
  }

  @Put('subscription')
  async putSubscription(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireReadable(actor, parseCnpj(cnpj));
    return this.subscriptions.put(actor, company, SubscriptionSchema.parse(body));
  }

  @Post('subscription/ack')
  @HttpCode(200)
  async ack(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireReadable(actor, parseCnpj(cnpj));
    return this.subscriptions.ack(actor, company, BigInt(AckSchema.parse(body).nsu));
  }

  // --- operação (só o dono) --------------------------------------------------------------------------------

  /**
   * Retoma a fila a partir de um NSU conhecido: decisão humana (depois de 656 ou de migrar de outro sistema).
   * NÃO antecipa a próxima consulta: o intervalo mínimo da SEFAZ continua valendo (spec §8.2).
   */
  @Post('sync/resume-from')
  @HttpCode(200)
  async resume(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireOwned(actor, parseCnpj(cnpj));
    const nsu = ResumeSchema.parse(body).nsu;
    await this.db.query(`UPDATE sync_state SET last_nsu = $2, consecutive_failures = 0, last_error = NULL WHERE company_id = $1`, [company.id, nsu]);
    await this.audit.record(actor, 'sync.resume_from', company.id, { nsu });
    return { lastNsu: nsu };
  }

  @Post('manifestations')
  @HttpCode(202)
  async manifest(@Param('cnpj') cnpj: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireOwned(actor, parseCnpj(cnpj));
    const { accessKeys } = ManifestSchema.parse(body);
    const { rowCount } = await this.db.query(
      `INSERT INTO manifestations (company_id, access_key) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [company.id, accessKeys],
    );
    await this.audit.record(actor, 'manifestation.queue', company.id, { count: accessKeys.length });
    return { queued: rowCount ?? 0 };
  }

  @Get('manifestations')
  async manifestations(@Param('cnpj') cnpj: string, @Query('status') status: string | undefined, @CurrentActor() actor: Actor) {
    const company = await this.companies.requireOwned(actor, parseCnpj(cnpj));
    const { rows } = await this.db.query(
      `SELECT access_key AS "accessKey", status, attempts, error, registered_at AS "registeredAt"
         FROM manifestations WHERE company_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY id DESC LIMIT 200`,
      [company.id, status ?? null],
    );
    return { items: rows };
  }
}
