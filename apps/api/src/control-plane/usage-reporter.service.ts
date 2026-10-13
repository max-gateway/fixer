import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { ControlPlaneClient } from './control-plane.client.js';
import { ControlPlaneConfig } from './control-plane.config.js';
import { monthStart, PlanLimits } from './plan-limits.service.js';

const FIRST_RUN_MS = 30_000;

/**
 * Informa ao control plane o consumo de cada organização com licença (usuários ativos e ordens do mês), para o backoffice e,
 * no futuro, a cobrança por consumo. Informa o TOTAL do período (idempotente), então repetir ou atrasar nunca soma duas vezes;
 * só reenvia quando o valor mudou. Falha de uma organização não atrapalha as outras.
 */
@Injectable()
export class UsageReporter implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(UsageReporter.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private readonly sent = new Map<string, number>();

  constructor(
    private readonly cfg: ControlPlaneConfig,
    private readonly system: SystemPrismaService,
    private readonly limits: PlanLimits,
    private readonly client: ControlPlaneClient,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.enabled) return;
    const every = Number(process.env.CONTROL_PLANE_USAGE_INTERVAL_MS ?? 15 * 60_000);
    this.timers.push(setTimeout(() => void this.runOnce(), FIRST_RUN_MS), setInterval(() => void this.runOnce(), every));
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  /** Um ciclo. Devolve quantos valores foram enviados. */
  async runOnce(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const period = monthStart(now).toISOString().slice(0, 7);
      const orgs = await this.system.orgLicense.findMany({ select: { orgId: true } });
      for (const { orgId } of orgs) {
        try {
          const usage = await TenantContext.run(orgId, () => this.limits.usage(now));
          for (const [metric, quantity] of Object.entries(usage)) {
            const key = `${orgId}:${metric}:${period}`;
            if (this.sent.get(key) === quantity) continue;
            await this.client.reportUsage(orgId, metric, quantity);
            this.sent.set(key, quantity);
            sent++;
          }
        } catch (err) {
          this.logger.warn(`Uso da organização ${orgId} não enviado: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Ciclo de uso falhou: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return sent;
  }
}
