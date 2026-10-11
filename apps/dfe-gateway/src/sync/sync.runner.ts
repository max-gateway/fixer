import { Inject, Injectable, Logger } from '@nestjs/common';
import { CredentialService } from '../credentials/credential.service.js';
import type { DistResult } from '../core/parser/dist-response.parser.js';
import { PfxError } from '../core/pfx.js';
import { type CredentialMaterial, type DfeSource, SefazNotConfiguredError, SefazTransportError } from '../core/sefaz/dfe-source.js';
import { Database } from '../db/database.service.js';
import { enqueueDeliveries } from '../delivery/outbox.js';
import { Metrics } from '../health/metrics.service.js';
import { type Decision, decide, decideTransportFailure, type Outcome } from './decide.js';
import { ingestBatch, type IngestCounters } from './ingest.js';
import { ManifestService } from './manifest.service.js';
import { DFE_SOURCE } from './tokens.js';

export interface RunResult {
  outcome: Outcome;
  cStat: number | null;
  counters?: IngestCounters;
}

interface Due {
  company_id: string;
  cnpj: string;
  uf_code: number | null;
  last_nsu: string;
  consecutive_failures: number;
  last_status_code: number | null;
  auto_manifest: boolean;
  not_after: Date;
}

/**
 * Uma rodada de sincronização de UM CNPJ (docs/specs/dfe-gateway.md §8.2): consulta a SEFAZ a partir do último
 * NSU, grava o lote e o novo NSU na MESMA transação e decide quando consultar de novo. Quem garante que só um
 * worker roda por CNPJ é o `SyncScheduler` (lease); aqui não há concorrência a tratar.
 */
@Injectable()
export class SyncRunner {
  private readonly logger = new Logger(SyncRunner.name);

  constructor(
    private readonly db: Database,
    private readonly credentials: CredentialService,
    @Inject(DFE_SOURCE) private readonly source: DfeSource,
    private readonly manifest: ManifestService,
    private readonly metrics: Metrics,
  ) {}

  async runOnce(companyId: string, now: Date = new Date(), random: () => number = Math.random): Promise<RunResult> {
    const { rows } = await this.db.query<Due>(
      `SELECT s.company_id, co.cnpj, co.uf_code, s.last_nsu::text, s.consecutive_failures, s.last_status_code,
              c.auto_manifest, c.not_after
         FROM sync_state s
         JOIN companies co ON co.id = s.company_id
         JOIN credentials c ON c.company_id = s.company_id
        WHERE s.company_id = $1 AND c.enabled`,
      [companyId],
    );
    const due = rows[0];
    if (!due) return { outcome: 'IDLE', cStat: null }; // sem certificado ou desligado: nada a fazer

    let material: CredentialMaterial;
    try {
      material = await this.credentials.openMaterial(companyId);
    } catch (err) {
      // Chave mestra perdida, blob corrompido ou .pfx ilegível: não se resolve repetindo.
      const reason = err instanceof PfxError ? err.message : 'Não foi possível decifrar o certificado';
      return this.disable(companyId, `${reason}. Reenvie o certificado`, due.consecutive_failures, now);
    }
    if (material.notAfter.getTime() <= now.getTime()) {
      await this.db.query(`UPDATE credentials SET status = 'EXPIRED' WHERE company_id = $1`, [companyId]);
      return this.disable(companyId, 'Certificado vencido. Envie o certificado renovado', due.consecutive_failures, now);
    }

    const lastNsu = BigInt(due.last_nsu);
    let res: DistResult;
    const t0 = process.hrtime.bigint();
    try {
      res = await this.source.distribute(material, { cnpj: due.cnpj, ufCode: due.uf_code, ultNsu: lastNsu });
    } catch (err) {
      this.metrics.sefazRequests.inc({ op: 'distribute', cstat: '0' });
      if (err instanceof SefazTransportError || err instanceof SefazNotConfiguredError) {
        return this.fail(companyId, decideTransportFailure(due.consecutive_failures, now, err.message), null, now);
      }
      throw err;
    } finally {
      this.metrics.sefazLatency.observe({ op: 'distribute' }, Number(process.hrtime.bigint() - t0) / 1e9);
    }
    this.metrics.sefazRequests.inc({ op: 'distribute', cstat: String(res.cStat) });

    // 138 sem ultNSU não tem como avançar a fila: tratar como resposta inválida em vez de repetir o lote.
    const invalid138 = res.cStat === 138 && res.ultNsu === null;
    const decision = invalid138
      ? decideTransportFailure(due.consecutive_failures, now, 'Resposta 138 sem ultNSU')
      : decide({
          cStat: res.cStat,
          xMotivo: res.xMotivo,
          ultNsu: res.ultNsu,
          maxNsu: res.maxNsu,
          prevFailures: due.consecutive_failures,
          prevStatusCode: due.last_status_code,
          now,
          random,
        });

    let counters: IngestCounters | undefined;
    try {
      counters = await this.db.tx(async (c) => {
        let batch: IngestCounters | undefined;
        if (res.cStat === 138 && !invalid138) {
          const { maxStoredNsu, minStoredNsu, ...out } = await ingestBatch(c, res.documents, { companyId, cnpj: due.cnpj, autoManifest: due.auto_manifest });
          batch = out;
          if (maxStoredNsu !== null && minStoredNsu !== null) await enqueueDeliveries(c, companyId, minStoredNsu, maxStoredNsu);
        }
        // O NSU só anda para a frente, e só na mesma transação que gravou os documentos.
        const advance = res.ultNsu !== null && (res.cStat === 138 || res.cStat === 137) && !invalid138;
        if (advance) {
          await c.query('UPDATE sync_state SET last_nsu = $2 WHERE company_id = $1 AND last_nsu <= $2', [companyId, res.ultNsu!.toString()]);
        }
        await this.applyDecision(c, companyId, decision, res.cStat, res.maxNsu, now);
        return batch;
      });
    } catch (err) {
      // Erro de banco: a transação voltou inteira, o NSU não andou e o lote reaparece na próxima rodada.
      this.logger.error(`Falha ao gravar o lote de ${due.cnpj} (NSU ${due.last_nsu}): ${(err as Error).message}`);
      return this.fail(companyId, decideTransportFailure(due.consecutive_failures, now, 'Falha ao gravar o lote no banco'), res.cStat, now);
    }

    if (counters) {
      this.metrics.documents.inc({ result: 'stored' }, counters.stored);
      this.metrics.documents.inc({ result: 'duplicate' }, counters.duplicate);
      this.metrics.documents.inc({ result: 'invalid' }, counters.invalid);
    }
    this.logger.log(
      `${due.cnpj}: cStat ${res.cStat} → ${decision.outcome}; NSU ${res.ultNsu ?? '-'}/${res.maxNsu ?? '-'}` + (counters ? `; ${JSON.stringify(counters)}` : ''),
    );
    if (decision.outcome === 'MORE' || decision.outcome === 'IDLE') {
      // Fora da transação e isolada de erros: falha aqui nunca desfaz o NSU nem derruba a sincronização.
      await this.manifest.runPending(material, companyId, due.cnpj, now).catch((err: Error) => this.logger.error(`Ciência falhou: ${err.message}`));
    }
    return { outcome: decision.outcome, cStat: res.cStat, counters };
  }

  private async applyDecision(
    c: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    companyId: string,
    d: Decision,
    cStat: number | null,
    maxNsu: bigint | null,
    now: Date,
  ) {
    const ok = d.outcome === 'MORE' || d.outcome === 'IDLE';
    await c.query(
      `UPDATE sync_state SET next_poll_at = $2, consecutive_failures = $3, last_error = $4, last_status_code = $5, last_run_at = $6,
              last_success_at = CASE WHEN $7 THEN $6 ELSE last_success_at END,
              max_nsu = COALESCE($8, max_nsu)
        WHERE company_id = $1`,
      [companyId, d.nextPollAt, d.failures, d.error, cStat, now, ok, maxNsu?.toString() ?? null],
    );
    if (d.outcome === 'DISABLE') await c.query(`UPDATE credentials SET enabled = false, status = CASE WHEN status = 'EXPIRED' THEN status ELSE 'DISABLED' END WHERE company_id = $1`, [companyId]);
  }

  private async fail(companyId: string, d: Decision, cStat: number | null, now: Date): Promise<RunResult> {
    await this.applyDecision(this.db, companyId, d, cStat, null, now);
    this.logger.warn(`Sincronização ${companyId}: ${d.error}`);
    return { outcome: d.outcome, cStat };
  }

  private async disable(companyId: string, error: string, prevFailures: number, now: Date): Promise<RunResult> {
    const d: Decision = { outcome: 'DISABLE', nextPollAt: new Date(now.getTime() + 3_600_000), failures: prevFailures + 1, error };
    return this.fail(companyId, d, null, now);
  }
}
