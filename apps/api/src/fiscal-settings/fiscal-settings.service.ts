import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  partFiscalIssues,
  serviceFiscalIssues,
  settingsFiscalIssues,
  type FiscalIssue,
  type PartFiscal,
  type ServiceFiscalProfileLike,
  type TaxRegimeCode,
  type TenantFiscalLike,
} from '@fixer/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PartFiscalInput, UpdateSettingsInput } from './schema.js';

const toNumber = (v: unknown): number | null => (v == null ? null : Number(v));
const describe = (issues: FiscalIssue[]) => issues.map((i) => i.message).join('; ');

interface ItemReport {
  name: string;
  issues: FiscalIssue[];
}
export interface OrderReadiness {
  ready: boolean;
  nfe: { required: boolean; ready: boolean; items: ItemReport[] };
  nfse: { required: boolean; ready: boolean; settingsIssues: FiscalIssue[]; items: ItemReport[] };
}

/**
 * Configuração e verificação fiscal (docs/specs/service-catalog.md §4.3 e §4.3.1).
 * Não emite nada: só garante que os dados estejam completos e confirmados pelo contador antes
 * de uma emissão futura. As colunas cnpj/legalName/ufCode de TenantFiscalSettings pertencem ao
 * fluxo de credenciais (fiscal-inbound) e nunca são escritas aqui.
 */
@Injectable()
export class FiscalSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    return this.prisma.tenantFiscalSettings.findUnique({ where: { id: 1 } });
  }

  updateSettings(input: UpdateSettingsInput) {
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return this.prisma.tenantFiscalSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
  }

  /** Alterar qualquer dado fiscal derruba a confirmação do contador: ela vale para os dados exatos que ele viu. */
  async updatePartFiscal(partId: string, input: PartFiscalInput) {
    const part = await this.requirePart(partId);
    const data: Record<string, unknown> = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const changed = Object.entries(data).some(([k, v]) => (part as Record<string, unknown>)[k] !== v);
    if (changed && part.fiscalVerified) data.fiscalVerified = false;
    return this.prisma.part.update({ where: { id: partId }, data });
  }

  async verifyPart(partId: string, verified: boolean) {
    const part = await this.requirePart(partId);
    if (verified) {
      const regime = await this.regime();
      const issues = partFiscalIssues({ ...part, fiscalVerified: true }, regime);
      if (issues.length) throw new BadRequestException(`Dados fiscais incompletos: ${describe(issues)}`);
    }
    return this.prisma.part.update({ where: { id: partId }, data: { fiscalVerified: verified } });
  }

  async verifyServiceProfile(profileId: string, verified: boolean) {
    const profile = await this.prisma.serviceFiscalProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Perfil fiscal não encontrado');
    if (verified) {
      const issues = serviceFiscalIssues({ ...profile, verified: true });
      if (issues.length) throw new BadRequestException(`Perfil fiscal incompleto: ${describe(issues)}`);
    }
    return this.prisma.serviceFiscalProfile.update({ where: { id: profileId }, data: { verified } });
  }

  /** O que impede emitir NF-e (peças) e NFS-e (serviços) desta OS. Só consulta; nada é emitido. */
  async orderReadiness(orderId: string): Promise<OrderReadiness> {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      include: {
        partLines: { include: { part: true } },
        serviceLines: { include: { service: { include: { fiscalProfile: true, definition: { include: { fiscalProfile: true } } } } } },
      },
    });
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada');

    const settings = await this.prisma.tenantFiscalSettings.findUnique({ where: { id: 1 } });
    const regime = (settings?.taxRegime ?? null) as TaxRegimeCode | null;

    const nfeItems: ItemReport[] = [];
    for (const l of order.partLines) {
      const issues = partFiscalIssues(l.part as unknown as PartFiscal, regime);
      if (issues.length) nfeItems.push({ name: l.partName, issues });
    }

    const nfseRequired = order.serviceLines.length > 0;
    const nfseItems: ItemReport[] = [];
    for (const l of order.serviceLines) {
      const profile = (l.service.fiscalProfile ?? l.service.definition?.fiscalProfile ?? null) as ServiceFiscalProfileLike | null;
      const issues = serviceFiscalIssues(profile);
      if (issues.length) nfseItems.push({ name: l.serviceName, issues });
    }
    const settingsIssues = nfseRequired
      ? settingsFiscalIssues(
          settings
            ? ({
                municipalityIbge: settings.municipalityIbge,
                taxRegime: regime,
                issRate: toNumber(settings.issRate),
                municipalServiceCode: settings.municipalServiceCode,
                hourlyRate: toNumber(settings.hourlyRate),
              } satisfies TenantFiscalLike)
            : null,
        )
      : [];

    const nfe = { required: order.partLines.length > 0, ready: nfeItems.length === 0, items: nfeItems };
    const nfse = { required: nfseRequired, ready: nfseItems.length === 0 && settingsIssues.length === 0, settingsIssues, items: nfseItems };
    return { ready: nfe.ready && nfse.ready, nfe, nfse };
  }

  private async regime(): Promise<TaxRegimeCode | null> {
    const s = await this.prisma.tenantFiscalSettings.findUnique({ where: { id: 1 }, select: { taxRegime: true } });
    return (s?.taxRegime ?? null) as TaxRegimeCode | null;
  }

  private async requirePart(id: string) {
    const part = await this.prisma.part.findUnique({ where: { id } });
    if (!part) throw new NotFoundException('Peça não encontrada');
    return part;
  }
}
