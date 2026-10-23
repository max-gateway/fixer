import { Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { TenantDirectory } from '../tenancy/tenant-directory.service.js';
import { FiscalAutofillService } from './fiscal-autofill.service.js';
import { IntegraContadorClient } from './integra-contador.client.js';

// Atualização mensal da RBT12 (docs/specs/fiscal-autofill.md §6.3): o PGDAS-D vence no dia 20, então a partir do dia 21 cada
// empresa do Simples que autorizou a leitura na Receita é atualizada sozinha. Cada tentativa custa consultas pagas, por isso:
// uma por empresa a cada 3 dias até dar certo, e só no mês corrente.

/** A declaração de `m-1` vence no dia 20 de `m`. */
export const REFRESH_FROM_DAY = 21;
export const RETRY_AFTER_MS = 3 * 24 * 3_600_000;
const TICK_MS = 6 * 3_600_000;

export interface RefreshCandidate {
  orgId: string;
  actorId: string;
  regime: string | null;
  attempts: { action: string; at: Date }[];
}

/** Dia do mês e início da janela (dia 21, 00:00 em Brasília) na data `now`. */
export function refreshWindow(now: Date): { day: number; start: Date } {
  const brt = new Date(now.getTime() - 3 * 3_600_000);
  return { day: brt.getUTCDate(), start: new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), REFRESH_FROM_DAY, 3)) };
}

/** Quem está devendo a atualização: Simples, dentro da janela, sem sucesso nela e sem tentativa nos últimos 3 dias. */
export function dueForRefresh(candidates: RefreshCandidate[], now: Date): RefreshCandidate[] {
  const { day, start } = refreshWindow(now);
  if (day < REFRESH_FROM_DAY) return [];
  const retryAfter = now.getTime() - RETRY_AFTER_MS;
  return candidates.filter(
    (c) =>
      c.regime === 'SIMPLES' &&
      !c.attempts.some((a) => a.action === 'autofill.refresh.ok' && a.at >= start) &&
      !c.attempts.some((a) => a.at.getTime() > retryAfter),
  );
}

@Injectable()
export class FiscalAutofillScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FiscalAutofillScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly autofill: FiscalAutofillService,
    @Optional() private readonly integra?: IntegraContadorClient,
    @Optional() private readonly directory?: TenantDirectory,
  ) {}

  onModuleInit(): void {
    if (process.env.FISCAL_AUTOFILL_REFRESH === 'false') return this.logger.log('Atualização mensal da Receita desligada (FISCAL_AUTOFILL_REFRESH=false).');
    if (!this.integra?.enabled || !this.directory) return;
    this.timer = setInterval(() => void this.tickAll(), TICK_MS);
    this.timer.unref();
    this.logger.log('Atualização mensal da RBT12 pela Receita ativa (a partir do dia 21).');
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Percorre as organizações devendo atualização; a falha de uma não atrapalha as outras. */
  async tickAll(now: Date = new Date()): Promise<{ refreshed: number; failed: number }> {
    const out = { refreshed: 0, failed: 0 };
    if (this.busy || !this.directory) return out;
    this.busy = true;
    try {
      const candidates = await this.directory.taxRefreshCandidates(new Date(now.getTime() - 45 * 24 * 3_600_000));
      for (const c of dueForRefresh(candidates, now)) {
        try {
          const ok = await TenantContext.run(c.orgId, () => this.refreshOne(c.actorId));
          if (ok) out.refreshed++;
        } catch (err) {
          out.failed++;
          this.logger.error(`Atualização fiscal da organização ${c.orgId} falhou`, err as Error);
        }
      }
    } catch (err) {
      this.logger.error('Falha ao listar organizações para atualização fiscal', err as Error);
    } finally {
      this.busy = false;
    }
    return out;
  }

  /** Roda o preenchimento como quem autorizou a leitura e registra a tentativa (ok quando a Receita entregou a RBT12). */
  private async refreshOne(actorId: string): Promise<boolean> {
    const report = await this.autofill.run({}, { id: actorId });
    // Valor da Receita encontrado, mesmo que um valor digitado tenha sido mantido (CONFLITO): não há o que insistir.
    const ok = report.fields.some((f) => f.field === 'rbt12' && (f.source === 'INTEGRA_PGDASD' || f.outcome === 'CONFLITO'));
    await this.prisma.fiscalAuditLog.create({
      data: { userId: actorId, action: ok ? 'autofill.refresh.ok' : 'autofill.refresh.try', detail: { steps: report.steps.map((s) => `${s.step}:${s.status}`) } },
    });
    return ok;
  }
}
