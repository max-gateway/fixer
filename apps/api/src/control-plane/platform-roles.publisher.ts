import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { platformRolesFor } from '../catalog-platform/platform-roles.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { ControlPlaneClient } from './control-plane.client.js';
import { ControlPlaneConfig } from './control-plane.config.js';

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const DEFAULT_INTERVAL_MS = 15 * 60_000;

export interface PublishResult {
  /** Papéis enviados ao control plane nesta rodada. */
  sent: number;
  /** Motivo de não ter feito nada, quando for o caso. */
  skipped?: 'disabled' | 'org_not_in_product';
}

/**
 * Informa ao control plane os papéis de PLATAFORMA que as permissões do Fixer implicam para cada pessoa da oficina.
 *
 * O control plane é o dono desses papéis (docs/specs/control-plane.md, "Papéis de plataforma"); o vocabulário e o que cada papel permite são do consumidor
 * (`@max-gateway/auth`). O Fixer só traduz as próprias permissões de negócio (`platformRolesFor`) e INFORMA, pela chave `product` presa ao Fixer, sem
 * poder tocar organização de outro produto. Quem LÊ os papéis é o `FixerTenantDirectory`, a partir da projeção que o control plane devolve: o Fixer não
 * decide acesso com a própria tradução.
 *
 * Idempotente e convergente: só envia quando o papel efetivo do control plane difere do que as permissões implicam; o evento que volta depois do envio
 * não gera novo envio. Nunca lança para quem chama (a mudança de acesso já foi gravada): falha vira aviso e a próxima rodada corrige.
 */
@Injectable()
export class PlatformRolesPublisher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlatformRolesPublisher.name);
  private readonly inFlight = new Map<string, Promise<PublishResult>>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly cfg: ControlPlaneConfig,
    private readonly client: ControlPlaneClient,
    private readonly system: SystemPrismaService,
  ) {}

  /** Reconciliação periódica: cobre o envio que falhou e a oficina que existia antes desta integração. Não bloqueia o boot. */
  onApplicationBootstrap(): void {
    if (!this.cfg.url || !this.cfg.apiKey) return;
    const every = Number(process.env.CONTROL_PLANE_ROLES_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    if (!Number.isFinite(every) || every <= 0) return;
    void this.reconcileAll();
    this.timer = setInterval(() => void this.reconcileAll(), every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Todas as organizações com licença deste produto. */
  async reconcileAll(): Promise<void> {
    try {
      const orgs = await this.system.orgLicense.findMany({ where: { mode: { not: 'none' } }, select: { orgId: true } });
      for (const { orgId } of orgs) await this.publishOrg(orgId);
    } catch (err) {
      this.logger.warn(`Reconciliação dos papéis de plataforma falhou: ${(err as Error).message}`);
    }
  }

  /** Uma execução por organização por vez: chamadas simultâneas (várias mudanças seguidas) compartilham a mesma rodada. */
  publishOrg(orgId: string): Promise<PublishResult> {
    const running = this.inFlight.get(orgId);
    if (running) return running;
    const p = this.run(orgId).finally(() => this.inFlight.delete(orgId));
    this.inFlight.set(orgId, p);
    return p;
  }

  private async run(orgId: string): Promise<PublishResult> {
    if (!this.cfg.url || !this.cfg.apiKey) return { sent: 0, skipped: 'disabled' };
    try {
      const members = await this.client.listMembers(orgId);
      if (!members) return { sent: 0, skipped: 'org_not_in_product' };
      const byEmail = new Map(members.filter((m) => m.status !== 'disabled').map((m) => [m.email.toLowerCase(), m]));

      const users = await this.system.user.findMany({
        where: { orgId, active: true },
        select: { email: true, roles: { select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } } },
      });
      let sent = 0;
      for (const u of users) {
        const member = byEmail.get(u.email.toLowerCase());
        if (!member) continue; // ainda não existe no control plane (a pessoa entra por lá)
        const wanted = [...new Set(platformRolesFor(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))))];
        if (sameSet(wanted, member.platformRoles)) continue;
        if (await this.client.setPlatformRoles(orgId, member.userId, wanted)) sent += 1;
      }
      if (sent > 0) this.logger.log(`Papéis de plataforma informados ao control plane: ${sent} pessoa(s) na organização ${orgId}.`);
      return { sent };
    } catch (err) {
      this.logger.warn(`Papéis de plataforma não informados (organização ${orgId}): ${(err as Error).message}`);
      return { sent: 0 };
    }
  }
}
