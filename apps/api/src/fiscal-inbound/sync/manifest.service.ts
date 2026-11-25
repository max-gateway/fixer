import { BadGatewayException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CredentialService, type CredentialMaterial } from '../credentials/credential.service.js';
import type { EventResult } from '../parser/event-response.parser.js';
import { GatewayClient, GatewayError } from '../gateway/gateway.client.js';
import { DFE_SOURCE, SefazNotConfiguredError, SefazTransportError, type DfeSource } from '../sefaz/dfe-source.js';

/** Após esta quantidade de rejeições a nota deixa de ser tentada sozinha e a UI mostra o erro (ação humana). */
export const MAX_MANIFEST_ATTEMPTS = 5;
/** Um lote de eventos tem de 1 a 20 eventos (NT 2020.001, P04). */
const BATCH_SIZE = 20;
/** Teto de notas por rodada: evita uma fila gigante prender o lease e a conexão com a SEFAZ. */
const MAX_PER_RUN = 200;

/** cStat do evento que significam "a Ciência está registrada" (ou a manifestação final já existe). */
const REGISTERED = new Set([135, 573, 655]);

export interface ManifestSummary {
  manifested: number;
  /** Rejeição por nota; a nota continua `SUMMARY` e volta a ser tentada com backoff. */
  rejected: number;
  /** Notas que não dá mais para manifestar (cancelada/denegada, fora do prazo): viram `IGNORED`. */
  ignored: number;
  /** Interrompido por falha de rede/serviço fora do ar; nenhuma nota foi penalizada. */
  aborted: string | null;
}

const emptySummary = (): ManifestSummary => ({ manifested: 0, rejected: 0, ignored: 0, aborted: null });

/** Espera antes de nova tentativa de uma nota rejeitada: 1 h, 2 h, 4 h, 8 h (teto 24 h). */
export const manifestBackoffMs = (attempts: number): number => Math.min(2 ** Math.max(0, attempts - 1), 24) * 3_600_000;

/**
 * Ciência da Operação (210210) das notas que só chegaram como resumo, para a SEFAZ liberar o XML completo
 * (NT 2014.002 §3). Só emite a Ciência: confirmação/desconhecimento são decisões humanas (D9).
 *
 * Atenção legal (NT 2020.001, item 2.D): depois da Ciência, o destinatário deve registrar a manifestação
 * conclusiva (confirmação, desconhecimento ou "não realizada") dentro do prazo, hoje 180 dias da autorização.
 */
@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialService,
    @Inject(DFE_SOURCE) private readonly source: DfeSource,
    @Optional() @Inject(GatewayClient) private readonly gateway: GatewayClient | null = null,
  ) {}

  /** Processa as notas `SUMMARY` elegíveis, em lotes de até 20. Nunca lança por falha de rede. */
  async runPending(material: CredentialMaterial, cnpj: string, now: Date = new Date()): Promise<ManifestSummary> {
    const pending = await this.prisma.purchaseInvoice.findMany({
      where: {
        status: 'SUMMARY',
        manifestAttempts: { lt: MAX_MANIFEST_ATTEMPTS },
        OR: [{ manifestNextAt: null }, { manifestNextAt: { lte: now } }],
      },
      orderBy: { receivedAt: 'asc' },
      take: MAX_PER_RUN,
      select: { id: true, accessKey: true, manifestAttempts: true },
    });

    const summary = emptySummary();
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const chunk = pending.slice(i, i + BATCH_SIZE);
      try {
        const res = await this.source.manifest(material, { cnpj, accessKeys: chunk.map((n) => n.accessKey), now });
        if (res.batchStatus !== 128) {
          // Serviço parado (108/109) não é culpa da nota; qualquer outra rejeição do lote conta como tentativa.
          if (res.batchStatus === 108 || res.batchStatus === 109) {
            summary.aborted = `SEFAZ ${res.batchStatus}: ${res.batchMotivo}`;
            break;
          }
          for (const n of chunk) await this.reject(n, `${res.batchStatus} ${res.batchMotivo}`, now, summary);
          continue;
        }
        const byKey = new Map(res.events.map((e) => [e.accessKey, e]));
        for (const n of chunk) await this.apply(n, byKey.get(n.accessKey), now, summary);
      } catch (err) {
        if (err instanceof SefazTransportError || err instanceof SefazNotConfiguredError) {
          summary.aborted = err.message;
          break;
        }
        throw err;
      }
    }
    if (pending.length > 0) this.logger.log(`Ciência da Operação: ${JSON.stringify(summary)} de ${pending.length} nota(s)`);
    return summary;
  }

  /** Ciência manual de uma nota (botão "Dar ciência e baixar XML"). Zera as tentativas e responde o resultado. */
  async manifestOne(invoiceId: string, now: Date = new Date()): Promise<{ status: string; message: string | null }> {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, accessKey: true, status: true, manifestAttempts: true },
    });
    if (!invoice) throw new NotFoundException('Nota não encontrada');
    if (invoice.status !== 'SUMMARY') throw new ConflictException(`A nota já está ${invoice.status}; não há ciência a dar`);

    const settings = await this.prisma.tenantFiscalSettings.findUnique({ where: { id: 1 }, select: { cnpj: true } });
    if (!settings?.cnpj) throw new ServiceUnavailableException('CNPJ da empresa não cadastrado');
    if (this.gateway) return this.queueViaGateway(settings.cnpj, invoice.accessKey);
    const material = await this.credentials.openMaterial();

    const summary = emptySummary();
    try {
      const res = await this.source.manifest(material, { cnpj: settings.cnpj, accessKeys: [invoice.accessKey], now });
      if (res.batchStatus !== 128) {
        await this.reject({ ...invoice, manifestAttempts: 0 }, `${res.batchStatus} ${res.batchMotivo}`, now, summary);
      } else {
        await this.apply({ ...invoice, manifestAttempts: 0 }, res.events.find((e) => e.accessKey === invoice.accessKey), now, summary);
      }
    } catch (err) {
      if (err instanceof SefazTransportError || err instanceof SefazNotConfiguredError) {
        throw new BadGatewayException(`Falha ao falar com a SEFAZ: ${err.message}`);
      }
      throw err;
    }
    const after = await this.prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { status: true, manifestError: true },
    });
    return { status: after.status, message: after.manifestError };
  }

  /**
   * Modo gateway: a ciência é feita pelo gateway (ele tem o certificado). Aqui só se enfileira a chave; quando
   * o gateway registrar, o `GatewayConsumer` passa a nota a `MANIFESTED` e o XML completo chega pelo cursor.
   */
  private async queueViaGateway(cnpj: string, accessKey: string): Promise<{ status: string; message: string | null }> {
    try {
      await this.gateway!.queueManifestations(cnpj, [accessKey]);
    } catch (err) {
      if (err instanceof GatewayError) throw new BadGatewayException(err.message);
      throw err;
    }
    return { status: 'SUMMARY', message: 'Ciência enviada. O XML completo chega em alguns minutos.' };
  }

  private async apply(n: PendingNote, event: EventResult | undefined, now: Date, s: ManifestSummary) {
    if (!event) return this.reject(n, 'A SEFAZ não devolveu resultado para o evento', now, s);

    if (REGISTERED.has(event.cStat)) {
      await this.mark(n, { status: 'MANIFESTED', manifestedAt: now, manifestError: null, manifestNextAt: null });
      s.manifested++;
    } else if (event.cStat === 650) {
      await this.mark(n, { status: 'IGNORED', ignoredReason: 'CANCELED_OR_DENIED', manifestError: null, manifestNextAt: null });
      s.ignored++;
    } else if (event.cStat === 596) {
      // Fora do prazo de manifestação: sem ciência não há XML por este caminho.
      await this.mark(n, { status: 'IGNORED', ignoredReason: 'MANIFEST_DEADLINE', manifestError: event.xMotivo, manifestNextAt: null });
      s.ignored++;
    } else {
      await this.reject(n, `${event.cStat} ${event.xMotivo}`, now, s);
    }
  }

  private async reject(n: PendingNote, error: string, now: Date, s: ManifestSummary) {
    const attempts = n.manifestAttempts + 1;
    await this.mark(n, {
      manifestAttempts: attempts,
      manifestError: error,
      // Esgotadas as tentativas, a nota para de ser escolhida sozinha (manifestAttempts < MAX no filtro).
      manifestNextAt: new Date(now.getTime() + manifestBackoffMs(attempts)),
    });
    s.rejected++;
  }

  /** Só atualiza se a nota ainda é SUMMARY: um procNFe que chegou no meio da conversa não é sobrescrito. */
  private mark(n: PendingNote, data: Record<string, unknown>) {
    return this.prisma.purchaseInvoice.updateMany({ where: { id: n.id, status: 'SUMMARY' }, data });
  }
}

interface PendingNote {
  id: string;
  accessKey: string;
  manifestAttempts: number;
}
