import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CredentialService } from '../credentials/credential.service.js';
import type { CredentialMaterial } from '../credentials/credential.service.js';
import { PfxError } from '../credentials/pfx.js';
import type { DistResult } from '../parser/dist-response.parser.js';
import { DFE_SOURCE, SefazNotConfiguredError, SefazTransportError, type DfeSource } from '../sefaz/dfe-source.js';
import { processBatch, type BatchCounters } from './batch.processor.js';
import { ManifestService } from './manifest.service.js';
import { decide, decideTransportFailure, type Decision, type Outcome } from './decide.js';

export interface RunResult {
  outcome: Outcome;
  cStat: number | null;
  counters?: BatchCounters;
}

/** Cota de tempo da transação que grava um lote de até 50 documentos. */
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

/**
 * Uma rodada de sincronização (docs/specs/nfe-import.md §6.2): consulta a SEFAZ a partir do último NSU,
 * grava o lote e o novo NSU na MESMA transação e decide quando consultar de novo. Quem garante que só
 * uma réplica roda por vez é o `SyncScheduler` (lease); aqui não há concorrência a tratar.
 */
@Injectable()
export class SyncRunner {
  private readonly logger = new Logger(SyncRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialService,
    @Inject(DFE_SOURCE) private readonly source: DfeSource,
    private readonly manifest: ManifestService,
  ) {}

  async runOnce(now: Date = new Date(), random: () => number = Math.random): Promise<RunResult> {
    const [state, settings] = await Promise.all([
      this.prisma.fiscalSyncState.findUnique({ where: { orgId: TenantContext.require() } }),
      this.prisma.tenantFiscalSettings.findUnique({ where: { orgId: TenantContext.require() }, select: { cnpj: true, ufCode: true } }),
    ]);
    if (!state) return { outcome: 'IDLE', cStat: null }; // sem certificado cadastrado: nada a fazer

    if (!settings?.cnpj) {
      return this.fail(decideTransportFailure(state.consecutiveFailures, now, 'CNPJ da empresa não cadastrado'), null, now);
    }

    let material: CredentialMaterial;
    try {
      material = await this.credentials.openMaterial();
    } catch (err) {
      // Chave mestra perdida, blob corrompido ou .pfx ilegível: não se resolve repetindo.
      const reason = err instanceof PfxError ? err.message : 'Não foi possível decifrar o certificado';
      return this.disable(`${reason}. Reenvie o certificado`, state.consecutiveFailures, now);
    }
    if (material.notAfter.getTime() <= now.getTime()) {
      return this.disable('Certificado vencido. Envie o certificado renovado', state.consecutiveFailures, now);
    }

    let res: DistResult;
    try {
      res = await this.source.distribute(material, { cnpj: settings.cnpj, ufCode: settings.ufCode, ultNsu: state.lastNsu });
    } catch (err) {
      if (err instanceof SefazTransportError || err instanceof SefazNotConfiguredError) {
        return this.fail(decideTransportFailure(state.consecutiveFailures, now, err.message), null, now);
      }
      throw err;
    }

    // 138 sem ultNSU não tem como avançar a fila: tratar como resposta inválida em vez de repetir o lote.
    const invalid138 = res.cStat === 138 && res.ultNsu === null;
    const decision = invalid138
      ? decideTransportFailure(state.consecutiveFailures, now, 'Resposta 138 sem ultNSU')
      : decide({
          cStat: res.cStat,
          xMotivo: res.xMotivo,
          ultNsu: res.ultNsu,
          maxNsu: res.maxNsu,
          prevFailures: state.consecutiveFailures,
          prevStatusCode: state.lastStatusCode,
          now,
          random,
        });

    let counters: BatchCounters | undefined;
    try {
      counters = await this.prisma.$transaction(async (tx) => {
        let batch: BatchCounters | undefined;
        if (res.cStat === 138 && !invalid138) {
          batch = await processBatch(tx, res.documents, { tenantCnpj: settings.cnpj!, now });
        }
        // O NSU só anda para a frente, e só na mesma transação que gravou os documentos.
        const advance = res.ultNsu !== null && (res.cStat === 138 || res.cStat === 137) && !invalid138;
        if (advance) {
          await tx.fiscalSyncState.updateMany({ where: { orgId: TenantContext.require(), lastNsu: { lte: res.ultNsu! } }, data: { lastNsu: res.ultNsu! } });
        }
        await this.applyDecision(tx, decision, res.cStat, res.maxNsu, now);
        return batch;
      }, TX_OPTIONS);
    } catch (err) {
      // Erro de banco: a transação voltou inteira, o NSU não andou e o lote reaparece na próxima rodada.
      this.logger.error(`Falha ao gravar o lote (NSU ${state.lastNsu}): ${(err as Error).message}`);
      return this.fail(decideTransportFailure(state.consecutiveFailures, now, 'Falha ao gravar o lote no banco'), res.cStat, now);
    }

    this.logger.log(
      `cStat ${res.cStat} → ${decision.outcome}; NSU ${res.ultNsu ?? '-'}/${res.maxNsu ?? '-'}` +
        (counters ? `; ${JSON.stringify(counters)}` : ''),
    );
    if (decision.outcome === 'MORE' || decision.outcome === 'IDLE') {
      await this.manifestPending(material, settings.cnpj, now);
    }
    return { outcome: decision.outcome, cStat: res.cStat, counters };
  }

  /**
   * Ciência automática das notas que chegaram só como resumo. Fica FORA da transação do lote e isolada
   * de erros: uma falha aqui nunca pode desfazer o NSU nem derrubar a sincronização (o XML completo só
   * chega na rodada seguinte, depois da ciência).
   */
  private async manifestPending(material: CredentialMaterial, cnpj: string, now: Date): Promise<void> {
    try {
      const flags = await this.prisma.fiscalCredential.findUnique({ where: { orgId: TenantContext.require() }, select: { autoManifest: true } });
      if (flags?.autoManifest) await this.manifest.runPending(material, cnpj, now);
    } catch (err) {
      this.logger.error(`Falha ao dar ciência às notas: ${(err as Error).message}`);
    }
  }

  private async applyDecision(
    tx: Pick<PrismaService, 'fiscalSyncState' | 'fiscalCredential'>,
    d: Decision,
    cStat: number | null,
    maxNsu: bigint | null,
    now: Date,
  ) {
    const ok = d.outcome === 'MORE' || d.outcome === 'IDLE';
    await tx.fiscalSyncState.update({
      where: { orgId: TenantContext.require() },
      data: {
        nextPollAt: d.nextPollAt,
        consecutiveFailures: d.failures,
        lastError: d.error,
        lastStatusCode: cStat,
        lastRunAt: now,
        ...(ok ? { lastSuccessAt: now } : {}),
        ...(maxNsu !== null ? { maxNsu } : {}),
      },
    });
    if (d.outcome === 'DISABLE') await tx.fiscalCredential.update({ where: { orgId: TenantContext.require() }, data: { enabled: false } });
  }

  private async fail(d: Decision, cStat: number | null, now: Date): Promise<RunResult> {
    await this.applyDecision(this.prisma, d, cStat, null, now);
    this.logger.warn(`Sincronização fiscal: ${d.error}`);
    return { outcome: d.outcome, cStat };
  }

  private async disable(error: string, prevFailures: number, now: Date): Promise<RunResult> {
    const d: Decision = { outcome: 'DISABLE', nextPollAt: new Date(now.getTime() + 3_600_000), failures: prevFailures + 1, error };
    return this.fail(d, null, now);
  }
}
