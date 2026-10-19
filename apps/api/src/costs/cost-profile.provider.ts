import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PRICING_CHANNEL, type PricingCostProfile } from '../pricing/cost-profile.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CostEngineClient } from './cost-engine.client.js';

type Composition = {
  profileVersion: number;
  items: { confidence: 'CONFIRMADO' | 'ESTIMADO' | 'DEFINIDO'; formula: { unitCost: string; insidePct: { fixed: string | null; variable: string; financial: string } } }[];
};

/**
 * Coeficientes do perfil de custos publicado para o preço da peça (docs/specs/cost-engine.md §6.6 e §14, fase 2). Uma
 * composição de um item com custo e imposto zero devolve a `formula` do canal: estrutura, despesas de venda, financeiro e o
 * custo extra por unidade. Uma chamada por plano, não por item. Nunca falha o preço: sem motor, vale a regra.
 */
@Injectable()
export class CostProfileProvider {
  private readonly logger = new Logger(CostProfileProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: CostEngineClient,
  ) {}

  async forPricing(): Promise<PricingCostProfile> {
    if (!this.engine.enabled) return { status: 'OFF' };
    const s = await this.prisma.tenantFiscalSettings.findFirst({ select: { cnpj: true } });
    if (!s?.cnpj) return { status: 'NONE' };
    try {
      const r = await this.engine.request<Composition>('POST', `/v1/companies/${s.cnpj}/compositions`, {
        channel: PRICING_CHANNEL,
        items: [{ ref: 'coeficientes', unitCost: 0, tax: { insidePct: 0, outside: [], confidence: 'CONFIRMADO' } }],
      });
      const f = r.items[0]!.formula;
      // Estrutura sem base de rateio vem nula: o preço segue sem ela (o perfil já avisa na aba Despesas).
      return {
        status: 'OK',
        version: r.profileVersion,
        channel: PRICING_CHANNEL,
        fixedPct: f.insidePct.fixed ?? '0',
        variablePct: f.insidePct.variable,
        financialPct: f.insidePct.financial,
        extraUnitCost: f.unitCost,
        confidence: r.items[0]!.confidence === 'CONFIRMADO' ? 'CONFIRMADO' : 'ESTIMADO',
      };
    } catch (err) {
      // Sem perfil publicado (409), empresa não cadastrada (404) ou canal ausente: preço pela regra, sem alarde.
      if (err instanceof HttpException && [404, 409].includes(err.getStatus())) return { status: 'NONE' };
      this.logger.warn(`Perfil de custos indisponível; o preço usa as despesas da regra: ${(err as Error).message}`);
      return { status: 'UNAVAILABLE' };
    }
  }
}
