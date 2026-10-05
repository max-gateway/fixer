import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PlateLookupConfig } from './plate-lookup.config.js';
import { PlateLookupResultSchema, type PlateLookupResult } from './schema.js';

/**
 * Cliente HTTP do microservice apps/plate-lookup (Python) — que por sua vez
 * fala com a API Puxa Placa. O core nunca chama a Puxa Placa diretamente,
 * nem guarda o token dela; isso fica isolado no microservice.
 */
@Injectable()
export class PlateLookupClient {
  private readonly logger = new Logger(PlateLookupClient.name);

  constructor(private readonly config: PlateLookupConfig) {}

  async consultaPlaca(plate: string): Promise<PlateLookupResult> {
    const url = `${this.config.serviceBaseUrl}/v1/consulta/${encodeURIComponent(plate)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err) {
      this.logger.error(`Falha ao chamar plate-lookup service para ${plate}`, err as Error);
      throw new HttpException(
        'Serviço de consulta de placa indisponível.',
        502,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `plate-lookup service retornou ${response.status} para ${plate}: ${body}`,
      );
      throw new HttpException(
        body || 'Falha ao consultar placa.',
        response.status,
      );
    }

    const json = await response.json();
    return PlateLookupResultSchema.parse(json);
  }
}
