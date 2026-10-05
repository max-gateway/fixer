import { Injectable, Logger } from '@nestjs/common';
import { PlateReadingsStore } from './plate-readings.store.js';
import type { PlateEvent } from './schema.js';

/**
 * Onde a lógica real de negócio do Fixer entra: gravar a leitura, disparar
 * liberação de acesso, notificar morador, etc.
 *
 * Lança erro se o processamento falhar — o consumer NÃO fará ACK da
 * mensagem e ela será reentregue (ver PlateEventsConsumerService). Idempotência
 * é responsabilidade desta classe: use `event.request_id` para deduplicar
 * caso o mesmo evento seja processado mais de uma vez (entrega
 * at-least-once do Redis Streams com consumer groups).
 */
@Injectable()
export class PlateEventsHandler {
  private readonly logger = new Logger(PlateEventsHandler.name);

  constructor(private readonly readings: PlateReadingsStore) {}

  async handle(event: PlateEvent): Promise<void> {
    // Toda leitura (inclusive rejeitada) é repassada ao frontend, que está
    // esperando o request_id; falha aqui faz o consumer não dar ACK e reentregar.
    await this.readings.save(event);

    if (event.result.status === 'rejected') {
      this.logger.debug(
        `[${event.location_id}] leitura rejeitada (request_id=${event.request_id}), ignorando.`,
      );
      return;
    }

    if (event.result.status === 'pending_vote') {
      // Ainda não fechou por votação (poucos frames ou confiança baixa).
      // Dependendo da política do Fixer, isso pode ser ignorado até chegar
      // um evento ACCEPTED subsequente, ou usado como sinal preliminar.
      this.logger.debug(
        `[${event.location_id}] leitura pendente de votação: ${event.result.plate ?? '?'} ` +
          `(confiança ${event.result.confidence.toFixed(1)}%)`,
      );
      return;
    }

    // status === 'accepted'
    this.logger.log(
      `[${event.location_id}] placa reconhecida: ${event.result.plate} ` +
        `(${event.result.plate_format}, confiança ${event.result.confidence.toFixed(1)}%, ` +
        `${event.result.frames_used} frame(s))`,
    );

    // TODO: integrar com a lógica real do Fixer, por exemplo:
    // await this.vehicleAccessService.registerEntry({
    //   plate: event.result.plate!,
    //   locationId: event.location_id,
    //   occurredAt: event.captured_at ?? event.processed_at,
    //   requestId: event.request_id, // usar para dedupe/idempotência
    // });
  }
}
