import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EventResult } from '../core/parser/event-response.parser.js';
import { DFE_SOURCE } from './tokens.js';
import { type CredentialMaterial, type DfeSource, SefazNotConfiguredError, SefazTransportError } from '../core/sefaz/dfe-source.js';
import { Database } from '../db/database.service.js';

/** Após esta quantidade de rejeições a chave deixa de ser tentada sozinha. */
export const MAX_MANIFEST_ATTEMPTS = 5;
/** Um lote de eventos tem de 1 a 20 eventos (NT 2020.001, P04). */
const BATCH_SIZE = 20;
/** Teto de chaves por rodada: evita uma fila gigante prender o lease e a conexão com a SEFAZ. */
const MAX_PER_RUN = 200;

/** cStat do evento que significam "a Ciência está registrada" (ou a manifestação final já existe). */
const REGISTERED = new Set([135, 573, 655]);

export interface ManifestSummary {
  registered: number;
  rejected: number;
  ignored: number;
  /** Interrompido por falha de rede/serviço fora do ar; nenhuma chave foi penalizada. */
  aborted: string | null;
}

/** Espera antes de nova tentativa de uma chave rejeitada: 1 h, 2 h, 4 h, 8 h (teto 24 h). */
export const manifestBackoffMs = (attempts: number): number => Math.min(2 ** Math.max(0, attempts - 1), 24) * 3_600_000;

interface Pending {
  id: string;
  access_key: string;
  attempts: number;
}

/**
 * Ciência da Operação (210210) das chaves enfileiradas, para a SEFAZ liberar o XML completo (NT 2014.002 §3).
 * Só emite a Ciência: confirmação/desconhecimento são decisões do produto cliente.
 *
 * Atenção legal (NT 2020.001, item 2.D): depois da Ciência, o destinatário deve registrar a manifestação
 * conclusiva dentro do prazo (hoje 180 dias da autorização).
 */
@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);

  constructor(
    private readonly db: Database,
    @Inject(DFE_SOURCE) private readonly source: DfeSource,
  ) {}

  /** Nunca lança por falha de rede: o runner não pode perder o NSU por causa da manifestação. */
  async runPending(material: CredentialMaterial, companyId: string, cnpj: string, now: Date = new Date()): Promise<ManifestSummary> {
    const { rows: pending } = await this.db.query<Pending>(
      `SELECT id::text, access_key, attempts FROM manifestations
        WHERE company_id = $1 AND status = 'PENDING' AND attempts < $2 AND next_at <= $3
        ORDER BY id LIMIT $4`,
      [companyId, MAX_MANIFEST_ATTEMPTS, now, MAX_PER_RUN],
    );
    const summary: ManifestSummary = { registered: 0, rejected: 0, ignored: 0, aborted: null };

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const chunk = pending.slice(i, i + BATCH_SIZE);
      try {
        const res = await this.source.manifest(material, { cnpj, accessKeys: chunk.map((n) => n.access_key), now });
        if (res.batchStatus !== 128) {
          // Serviço parado (108/109) não é culpa da chave; qualquer outra rejeição do lote conta como tentativa.
          if (res.batchStatus === 108 || res.batchStatus === 109) {
            summary.aborted = `SEFAZ ${res.batchStatus}: ${res.batchMotivo}`;
            break;
          }
          for (const n of chunk) await this.reject(n, `${res.batchStatus} ${res.batchMotivo}`, now, summary);
          continue;
        }
        const byKey = new Map(res.events.map((e) => [e.accessKey, e]));
        for (const n of chunk) await this.apply(n, byKey.get(n.access_key), now, summary);
      } catch (err) {
        if (err instanceof SefazTransportError || err instanceof SefazNotConfiguredError) {
          summary.aborted = err.message;
          break;
        }
        this.logger.error(`Falha ao manifestar: ${(err as Error).message}`);
        summary.aborted = 'erro interno';
        break;
      }
    }
    if (pending.length > 0) this.logger.log(`Ciência da Operação (${cnpj}): ${JSON.stringify(summary)} de ${pending.length} chave(s)`);
    return summary;
  }

  private async apply(n: Pending, event: EventResult | undefined, now: Date, s: ManifestSummary) {
    if (!event) return this.reject(n, 'A SEFAZ não devolveu resultado para o evento', now, s);
    if (REGISTERED.has(event.cStat)) {
      await this.mark(n, `status = 'REGISTERED', registered_at = $2, error = NULL`, [now]);
      s.registered++;
    } else if (event.cStat === 650 || event.cStat === 596) {
      // 650: cancelada/denegada. 596: fora do prazo de manifestação. Não há mais o que tentar.
      await this.mark(n, `status = 'IGNORED', error = $2`, [`${event.cStat} ${event.xMotivo}`]);
      s.ignored++;
    } else {
      await this.reject(n, `${event.cStat} ${event.xMotivo}`, now, s);
    }
  }

  private async reject(n: Pending, error: string, now: Date, s: ManifestSummary) {
    const attempts = n.attempts + 1;
    await this.mark(n, `attempts = $2, error = $3, next_at = $4`, [attempts, error, new Date(now.getTime() + manifestBackoffMs(attempts))]);
    s.rejected++;
  }

  private mark(n: Pending, set: string, params: unknown[]) {
    return this.db.query(`UPDATE manifestations SET ${set} WHERE id = $1`, [n.id, ...params]);
  }
}
