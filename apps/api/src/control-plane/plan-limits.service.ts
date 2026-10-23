import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LicenseService } from './license.service.js';

/** Chaves de direito que o Fixer entende. O plano as define no control plane (API admin); chave ausente = sem restrição. */
export const ENTITLEMENT = {
  /** limit: máximo de usuários ativos. -1 = ilimitado. */
  users: 'users',
  /** metered: máximo de ordens de serviço criadas por mês. -1 = ilimitado. */
  ordersPerMonth: 'service_orders_per_month',
} as const;

/** Início do mês corrente em Brasília (o Brasil não tem horário de verão desde 2019, então -03:00 fixo). */
export function monthStart(now: Date = new Date()): Date {
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
  return new Date(`${ym}-01T00:00:00-03:00`);
}

const paymentRequired = (error: string, message: string, extra: object = {}) =>
  new HttpException({ statusCode: 402, error, message, ...extra }, HttpStatus.PAYMENT_REQUIRED);

/**
 * Aplica os direitos do plano da organização atual. Sem licença conhecida (instalação legada) nada é limitado.
 * Os limites são conferidos na hora de criar (leitura e conta são baratas e só rodam quando o plano define o limite).
 * Duas criações simultâneas no último lugar podem passar uma acima: aceitável para um limite comercial, e sem lock global.
 */
@Injectable()
export class PlanLimits {
  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
  ) {}

  /** Valor numérico do direito, ou `null` quando não há limite (sem licença, chave ausente ou -1). */
  async limit(key: string): Promise<number | null> {
    const ent = (await this.license.state()).entitlements?.[key];
    if (!ent || typeof ent.value !== 'number' || ent.value < 0) return null;
    return ent.value;
  }

  /** Funcionalidade do plano: só bloqueia se o plano a define explicitamente como desligada. */
  async assertFeature(key: string): Promise<void> {
    const ent = (await this.license.state()).entitlements?.[key];
    if (ent && ent.value === false) {
      throw paymentRequired('feature_not_in_plan', 'Esta funcionalidade não está incluída no seu plano', { feature: key });
    }
  }

  /** Um usuário NOVO só entra se couber no plano. Quem já existe sempre entra. */
  async assertUserSlot(keycloakId: string): Promise<void> {
    const max = await this.limit(ENTITLEMENT.users);
    if (max === null) return;
    const exists = await this.prisma.user.findFirst({ where: { keycloakId }, select: { id: true } });
    if (exists) return;
    const used = await this.prisma.user.count({ where: { active: true } });
    if (used >= max) {
      throw paymentRequired('plan_limit_reached', `Limite de ${max} usuário(s) do plano atingido`, { limit: ENTITLEMENT.users, max, used });
    }
  }

  /** Vale antes de dar acesso a mais alguém (convite, reativação): conta os usuários ativos, sem exceção para quem já existe. */
  async assertActiveUserSlot(): Promise<void> {
    const max = await this.limit(ENTITLEMENT.users);
    if (max === null) return;
    const used = await this.prisma.user.count({ where: { active: true } });
    if (used >= max) {
      throw paymentRequired('plan_limit_reached', `Limite de ${max} usuário(s) do plano atingido`, { limit: ENTITLEMENT.users, max, used });
    }
  }

  /** Para a tela de acessos: quantos usuários ativos cabem no plano (`max: null` = sem limite). */
  async userSeats(): Promise<{ max: number | null; used: number }> {
    const [max, used] = await Promise.all([this.limit(ENTITLEMENT.users), this.prisma.user.count({ where: { active: true } })]);
    return { max, used };
  }

  async assertOrderSlot(now: Date = new Date()): Promise<void> {
    const max = await this.limit(ENTITLEMENT.ordersPerMonth);
    if (max === null) return;
    const used = await this.prisma.serviceOrder.count({ where: { createdAt: { gte: monthStart(now) } } });
    if (used >= max) {
      throw paymentRequired('plan_limit_reached', `Limite de ${max} ordem(ns) de serviço por mês do plano atingido`, {
        limit: ENTITLEMENT.ordersPerMonth,
        max,
        used,
      });
    }
  }

  /** Consumo atual da organização do contexto, na forma que o control plane recebe. */
  async usage(now: Date = new Date()): Promise<Record<string, number>> {
    const [users, orders] = await Promise.all([
      this.prisma.user.count({ where: { active: true } }),
      this.prisma.serviceOrder.count({ where: { createdAt: { gte: monthStart(now) } } }),
    ]);
    return { [ENTITLEMENT.users]: users, [ENTITLEMENT.ordersPerMonth]: orders };
  }
}
