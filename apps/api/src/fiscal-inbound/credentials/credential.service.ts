import { TenantContext } from '../../tenancy/tenant-context.js';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { cnpjBase, isValidCnpj, normalizeCnpj } from '../cnpj.js';
import { type KeyProvider } from '../crypto/key-provider.js';
import { open, seal } from '../crypto/secret-box.js';
import { GatewayClient, GatewayError } from '../gateway/gateway.client.js';
import { certificateAlert, type CertificateAlert } from './certificate-alert.js';
import { parsePfx, PfxError, type ParsedPfx } from './pfx.js';

export const KEY_PROVIDER = Symbol('FISCAL_KEY_PROVIDER');

const CTX_PFX = 'fiscal-credential:pfx';
const CTX_PASS = 'fiscal-credential:pfx-pass';
/** O certificado precisa valer por pelo menos isto; evita aceitar um que vence antes do primeiro ciclo. */
const MIN_VALID_DAYS = 7;
const MAX_PFX_BYTES = 256 * 1024;
/** O que `remove` apaga além do certificado (vai para a auditoria). */
const WIPED_ON_REMOVE = ['pricingRule', 'tenantTaxProfile', 'taxTableReview', 'fiscalFieldProvenance', 'tenantFiscalSettings'];

export const SettingsSchema = z.object({
  cnpj: z
    .string()
    .transform(normalizeCnpj)
    .refine(isValidCnpj, 'CNPJ inválido'),
  legalName: z.string().trim().min(1).max(200).optional(),
  ufCode: z.number().int().min(11).max(53).optional(),
});

export const UploadCredentialSchema = z.object({
  pfxBase64: z.string().min(1, 'Envie o arquivo .pfx em base64'),
  password: z.string().min(1, 'Informe a senha do certificado'),
  environment: z.enum(['PRODUCTION', 'HOMOLOGATION']).default('PRODUCTION'),
});

export const InspectCredentialSchema = UploadCredentialSchema.pick({ pfxBase64: true, password: true });

export const FlagsSchema = z
  .object({
    enabled: z.boolean(),
    autoManifest: z.boolean(),
    autoExport: z.boolean(),
    /**
     * Ciente de que a Ciência da Operação automática cria o dever de registrar depois a manifestação
     * conclusiva (confirmação, desconhecimento ou "não realizada") em até 180 dias (NT 2020.001, item 2.D).
     * Exigido para ligar `autoManifest`; não é gravado, só auditado.
     */
    acknowledgeManifestDuty: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar')
  .refine(
    (v) => v.autoManifest !== true || v.acknowledgeManifestDuty === true,
    'Para ligar a ciência automática, confirme que está ciente da obrigação de manifestação conclusiva (acknowledgeManifestDuty)',
  );

export interface Actor {
  id: string;
  ip?: string;
}

/** Material decifrado, só em memória, para a rodada de sincronização (fase 2). Nunca logar nem serializar. */
export interface CredentialMaterial extends ParsedPfx {
  environment: 'PRODUCTION' | 'HOMOLOGATION';
}

@Injectable()
export class CredentialService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
    /** Presente só no modo gateway: o certificado vive no `dfe-gateway` e aqui fica apenas um espelho para a tela. */
    @Optional() @Inject(GatewayClient) private readonly gateway?: GatewayClient,
  ) {}

  /** Traduz erro do gateway para o que a API do Fixer já devolve (o usuário vê a mensagem do problem+json). */
  private async viaGateway<T>(fn: (g: GatewayClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.gateway!);
    } catch (err) {
      if (!(err instanceof GatewayError)) throw err;
      if (err.status === 404) throw new NotFoundException(err.message);
      if (err.status === 409) throw new ConflictException(err.message);
      if (err.status >= 400 && err.status < 500) throw new BadRequestException(err.message);
      throw new ServiceUnavailableException(err.message);
    }
  }

  getSettings() {
    return this.prisma.tenantFiscalSettings.findUnique({
      where: { orgId: TenantContext.require() },
      select: { cnpj: true, legalName: true, ufCode: true },
    });
  }

  /** Trocar a raiz do CNPJ com certificado já enviado quebraria a validação do WS (rejeição 593): exige remover antes. */
  async updateSettings(input: z.infer<typeof SettingsSchema>, actor: Actor) {
    const current = await this.prisma.tenantFiscalSettings.findUnique({ where: { orgId: TenantContext.require() }, select: { cnpj: true } });
    if (current?.cnpj && cnpjBase(current.cnpj) !== cnpjBase(input.cnpj)) {
      const hasCredential = await this.prisma.fiscalCredential.count();
      if (hasCredential > 0) {
        throw new ConflictException('Remova o certificado antes de trocar a raiz do CNPJ');
      }
    }
    const saved = await this.prisma.tenantFiscalSettings.upsert({
      where: { orgId: TenantContext.require() },
      create: { orgId: TenantContext.require(), ...input },
      update: input,
      select: { cnpj: true, legalName: true, ufCode: true },
    });
    await this.audit(actor, 'settings.update', { cnpj: input.cnpj });
    return saved;
  }

  async status() {
    const [settings, credential] = await Promise.all([
      this.getSettings(),
      this.prisma.fiscalCredential.findUnique({
        where: { orgId: TenantContext.require() },
        select: {
          environment: true,
          subject: true,
          certCnpj: true,
          notBefore: true,
          notAfter: true,
          enabled: true,
          autoManifest: true,
          autoExport: true,
          updatedAt: true,
          syncState: {
            select: {
              lastNsu: true,
              maxNsu: true,
              nextPollAt: true,
              lastStatusCode: true,
              lastError: true,
              lastRunAt: true,
              lastSuccessAt: true,
              consecutiveFailures: true,
            },
          },
        },
      }),
    ]);
    return {
      keyAvailable: this.gateway ? true : this.keys.available,
      settings,
      credential: credential && {
        ...credential,
        syncState: credential.syncState && {
          ...credential.syncState,
          lastNsu: credential.syncState.lastNsu.toString(),
          maxNsu: credential.syncState.maxNsu.toString(),
        },
      },
    };
  }

  /** Alerta de vencimento para o banner (leve: uma leitura, sem sync state). `null` = nada a avisar. */
  async expiryAlert(now: Date = new Date()): Promise<CertificateAlert | null> {
    const cred = await this.prisma.fiscalCredential.findUnique({
      where: { orgId: TenantContext.require() },
      select: { notAfter: true, mirroredAt: true, keyId: true },
    });
    if (!cred) return null;
    return certificateAlert({ notAfter: cred.notAfter, mirroredAt: cred.mirroredAt, viaGateway: cred.keyId === 'gateway' }, now);
  }

  /** Abre o .pfx só para ler titular e CNPJ (cadastro guiado pelo certificado). Não grava nada nem exige CNPJ prévio. */
  inspect(input: z.infer<typeof InspectCredentialSchema>) {
    if (this.gateway) return this.viaGateway((g) => g.inspect(input.pfxBase64, input.password));
    const pfx = Buffer.from(input.pfxBase64, 'base64');
    if (pfx.length === 0 || pfx.length > MAX_PFX_BYTES) throw new BadRequestException('Arquivo .pfx inválido ou grande demais');
    const { subject, certCnpj, notBefore, notAfter } = this.parse(pfx, input.password);
    return { subject, certCnpj, notBefore, notAfter };
  }

  /** Valida o .pfx e grava só o ciphertext. Reenvio (renovação) preserva NSU e flags. */
  async upload(input: z.infer<typeof UploadCredentialSchema>, actor: Actor) {
    if (this.gateway) return this.uploadViaGateway(input, actor);
    this.requireKeys();
    const settings = await this.getSettings();
    if (!settings?.cnpj) throw new BadRequestException('Cadastre o CNPJ da empresa antes de enviar o certificado');

    const pfx = Buffer.from(input.pfxBase64, 'base64');
    if (pfx.length === 0 || pfx.length > MAX_PFX_BYTES) throw new BadRequestException('Arquivo .pfx inválido ou grande demais');

    const parsed = this.parse(pfx, input.password);
    if (cnpjBase(parsed.certCnpj) !== cnpjBase(settings.cnpj)) {
      throw new BadRequestException('O CNPJ do certificado não pertence à mesma raiz do CNPJ da empresa');
    }
    const now = Date.now();
    if (parsed.notAfter.getTime() < now) throw new BadRequestException('Certificado vencido');
    if (parsed.notAfter.getTime() - now < MIN_VALID_DAYS * 86_400_000) {
      throw new BadRequestException(`Certificado vence em menos de ${MIN_VALID_DAYS} dias`);
    }
    if (parsed.notBefore.getTime() > now) throw new BadRequestException('Certificado ainda não é válido');

    const sealedPfx = await seal(this.keys, pfx, CTX_PFX);
    const sealedPass = await seal(this.keys, Buffer.from(input.password, 'utf8'), CTX_PASS);
    const data = {
      environment: input.environment,
      pfxCiphertext: sealedPfx.blob,
      pfxPassCiphertext: sealedPass.blob,
      keyId: sealedPfx.keyId,
      subject: parsed.subject,
      certCnpj: parsed.certCnpj,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
      uploadedById: actor.id,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalCredential.upsert({ where: { orgId: TenantContext.require() }, create: { orgId: TenantContext.require(), ...data }, update: data });
      // Só cria o estado na primeira vez: renovar o certificado não pode zerar o NSU.
      await tx.fiscalSyncState.upsert({ where: { orgId: TenantContext.require() }, create: { orgId: TenantContext.require() }, update: {} });
    });
    await this.audit(actor, 'credential.upload', {
      subject: parsed.subject,
      certCnpj: parsed.certCnpj,
      notAfter: parsed.notAfter,
      environment: input.environment,
    });
    return { subject: parsed.subject, certCnpj: parsed.certCnpj, notBefore: parsed.notBefore, notAfter: parsed.notAfter };
  }

  async updateFlags(input: z.infer<typeof FlagsSchema>, actor: Actor) {
    if (this.gateway) return this.updateFlagsViaGateway(input, actor);
    const credential = await this.prisma.fiscalCredential.findUnique({ where: { orgId: TenantContext.require() }, select: { orgId: true } });
    if (!credential) throw new NotFoundException('Nenhum certificado cadastrado');
    const { acknowledgeManifestDuty: _ack, ...persisted } = input;
    const data: Record<string, unknown> = { ...persisted };
    if (input.autoExport !== undefined) data.autoExportById = input.autoExport ? actor.id : null;
    await this.prisma.fiscalCredential.update({ where: { orgId: TenantContext.require() }, data });
    await this.audit(actor, 'flags.update', input);
    return this.status();
  }

  async remove(actor: Actor) {
    if (this.gateway) return this.removeViaGateway(actor);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.fiscalCredential.deleteMany({ where: { orgId: TenantContext.require() } });
      if (count === 0) throw new NotFoundException('Nenhum certificado cadastrado');
      await this.wipeConfiguration(tx);
    });
    await this.audit(actor, 'credential.delete', { wiped: WIPED_ON_REMOVE });
  }

  /**
   * Remover o certificado zera a configuração fiscal e de precificação da empresa (dados da empresa, origem dos valores,
   * perfil tributário, aceites das tabelas e regras de preço): tudo isso vale para o CNPJ que sai. Ficam as notas, o
   * estoque, o histórico de preços e a auditoria, que são o passado da oficina.
   */
  private async wipeConfiguration(tx: Pick<PrismaService, 'pricingRule' | 'tenantTaxProfile' | 'taxTableReview' | 'fiscalFieldProvenance' | 'tenantFiscalSettings'>) {
    const where = { orgId: TenantContext.require() };
    await tx.pricingRule.deleteMany({ where });
    await tx.tenantTaxProfile.deleteMany({ where });
    await tx.taxTableReview.deleteMany({ where });
    await tx.fiscalFieldProvenance.deleteMany({ where });
    await tx.tenantFiscalSettings.deleteMany({ where });
  }

  // --- modo gateway -----------------------------------------------------------------------------------------

  /**
   * O .pfx e a senha vão direto ao gateway, em memória, e NÃO são gravados aqui. Localmente fica um espelho
   * (assunto, validade, flags) para a tela e para o `FiscalSyncState`; as colunas de cifra ficam vazias
   * (`keyId = 'gateway'`). Reenvio (renovação) preserva NSU e flags dos dois lados.
   */
  private async uploadViaGateway(input: z.infer<typeof UploadCredentialSchema>, actor: Actor) {
    const settings = await this.getSettings();
    if (!settings?.cnpj) throw new BadRequestException('Cadastre o CNPJ da empresa antes de enviar o certificado');
    const cnpj = settings.cnpj;
    const who = actor.id;

    // Mesma regra do modo direto, antes de cadastrar: depois do register o certificado já estaria no gateway.
    const inspected = await this.viaGateway((g) => g.inspect(input.pfxBase64, input.password));
    if (cnpjBase(inspected.certCnpj) !== cnpjBase(cnpj)) {
      throw new BadRequestException('O CNPJ do certificado não pertence à mesma raiz do CNPJ da empresa');
    }

    // Uma chamada de cadastro: o gateway cria a empresa, instala o certificado só se mudou e retoma do NSU que este tenant já
    // tinha (só vale se o dele estiver zerado). Flags não são enviadas: reenviar o certificado preserva as atuais.
    const existing = await this.prisma.fiscalSyncState.findUnique({ where: { orgId: TenantContext.require() }, select: { lastNsu: true } });
    const gw = await this.viaGateway((g) =>
      g.register(
        cnpj,
        {
          legalName: settings.legalName ?? undefined,
          ufCode: settings.ufCode ?? undefined,
          credential: input,
          ...(existing && existing.lastNsu > 0n ? { resumeFromNsu: existing.lastNsu.toString() } : {}),
        },
        who,
      ),
    );
    const cred = gw.credential;
    if (!cred) throw new ServiceUnavailableException('O serviço de notas fiscais não confirmou o certificado. Tente de novo.');

    const data = {
      environment: input.environment,
      pfxCiphertext: Buffer.alloc(0),
      pfxPassCiphertext: Buffer.alloc(0),
      keyId: 'gateway',
      subject: cred.subject,
      certCnpj: cred.cert_cnpj,
      notBefore: new Date(cred.not_before),
      notAfter: new Date(cred.not_after),
      mirroredAt: new Date(),
      enabled: cred.enabled,
      autoManifest: cred.auto_manifest,
      uploadedById: actor.id,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalCredential.upsert({ where: { orgId: TenantContext.require() }, create: { orgId: TenantContext.require(), ...data }, update: data });
      await tx.fiscalSyncState.upsert({ where: { orgId: TenantContext.require() }, create: { orgId: TenantContext.require() }, update: {} });
    });
    await this.audit(actor, 'credential.upload', { subject: cred.subject, certCnpj: cred.cert_cnpj, notAfter: cred.not_after, environment: input.environment, via: 'gateway', changed: gw.changed?.credential });
    return { subject: cred.subject, certCnpj: cred.cert_cnpj, notBefore: new Date(cred.not_before), notAfter: new Date(cred.not_after) };
  }

  private async updateFlagsViaGateway(input: z.infer<typeof FlagsSchema>, actor: Actor) {
    const cred = await this.prisma.fiscalCredential.findUnique({ where: { orgId: TenantContext.require() }, select: { orgId: true } });
    const settings = await this.getSettings();
    if (!cred || !settings?.cnpj) throw new NotFoundException('Nenhum certificado cadastrado');
    const cnpj = settings.cnpj;

    const remote = { enabled: input.enabled, autoManifest: input.autoManifest, acknowledgeManifestDuty: input.acknowledgeManifestDuty };
    const data: Record<string, unknown> = {};
    if (input.enabled !== undefined || input.autoManifest !== undefined) {
      const applied = await this.viaGateway((g) => g.patchCredential(cnpj, remote, actor.id));
      data.enabled = applied.enabled;
      data.autoManifest = applied.autoManifest;
    }
    if (input.autoExport !== undefined) {
      data.autoExport = input.autoExport;
      data.autoExportById = input.autoExport ? actor.id : null;
    }
    await this.prisma.fiscalCredential.update({ where: { orgId: TenantContext.require() }, data });
    await this.audit(actor, 'flags.update', input);
    return this.status();
  }

  private async removeViaGateway(actor: Actor) {
    const settings = await this.getSettings();
    if (!settings?.cnpj) throw new NotFoundException('Nenhum certificado cadastrado');
    const cnpj = settings.cnpj;
    try {
      await this.viaGateway((g) => g.deleteCredential(cnpj, actor.id));
    } catch (err) {
      // 404 = o gateway não tem (mais) certificado desse CNPJ para este cliente (nunca cadastrado, já removido, ou o
      // registro local veio do modo direto). O objetivo, "sem certificado", já vale: limpa o espelho local e segue.
      if (!(err instanceof NotFoundException)) throw err;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalCredential.deleteMany({ where: { orgId: TenantContext.require() } });
      await this.wipeConfiguration(tx);
    });
    await this.audit(actor, 'credential.delete', { via: 'gateway', wiped: WIPED_ON_REMOVE });
  }

  /** Decifra o certificado para uma rodada de sincronização. O retorno vive só na memória do chamador. */
  async openMaterial(): Promise<CredentialMaterial> {
    this.requireKeys();
    const row = await this.prisma.fiscalCredential.findUnique({ where: { orgId: TenantContext.require() } });
    if (!row) throw new NotFoundException('Nenhum certificado cadastrado');
    const pfx = await open(this.keys, row.keyId, Buffer.from(row.pfxCiphertext), CTX_PFX);
    const password = (await open(this.keys, row.keyId, Buffer.from(row.pfxPassCiphertext), CTX_PASS)).toString('utf8');
    return { ...parsePfx(pfx, password), environment: row.environment };
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
    if (!this.keys.available) {
      throw new ServiceUnavailableException('Chave de criptografia fiscal não configurada neste ambiente');
    }
  }

  private audit(actor: Actor, action: string, detail: unknown) {
    return this.prisma.fiscalAuditLog.create({
      data: { userId: actor.id, action, detail: detail as object, ip: actor.ip },
    });
  }
}
