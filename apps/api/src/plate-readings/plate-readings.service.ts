import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { PlateReadingsStore, type StoredReading } from '../plate-events/plate-readings.store.js';

const READER_URL = () => process.env.PLATE_READER_URL ?? 'http://localhost:8080';
const LOCATION_ID = () => process.env.PLATE_READER_LOCATION_ID ?? 'balcao';
const TIMEOUT_MS = 15_000;

export type ReadingResponse = { status: 'processing' } | ({ requestId: string } & StoredReading);

@Injectable()
export class PlateReadingsService {
  private readonly logger = new Logger(PlateReadingsService.name);

  constructor(private readonly store: PlateReadingsStore) {}

  /** Envia a imagem ao plate-reader (202 + request_id); o resultado chega pelo stream. */
  async submit(image: { buffer: Buffer; mimetype: string; originalname: string }): Promise<{ requestId: string }> {
    const form = new FormData();
    form.set('location_id', LOCATION_ID());
    form.append('frames', new Blob([new Uint8Array(image.buffer)], { type: image.mimetype }), image.originalname);

    let res: Response;
    try {
      res = await fetch(`${READER_URL()}/v1/recognize`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error('Falha ao chamar o plate-reader', err as Error);
      throw new BadGatewayException('Serviço de leitura de placa indisponível.');
    }
    if (!res.ok) {
      this.logger.warn(`plate-reader respondeu ${res.status}: ${await res.text().catch(() => '')}`);
      throw new BadGatewayException('Falha ao enviar a imagem para leitura.');
    }
    const body = (await res.json()) as { request_id?: string };
    if (!body.request_id) throw new BadGatewayException('Resposta inválida do serviço de leitura.');
    return { requestId: body.request_id };
  }

  async result(requestId: string): Promise<ReadingResponse> {
    const stored = await this.store.get(requestId);
    return stored ? { requestId, ...stored } : { status: 'processing' };
  }
}
