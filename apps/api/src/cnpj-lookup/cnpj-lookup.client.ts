import { HttpException, Injectable, Logger } from '@nestjs/common';
import { CnpjLookupConfig } from './cnpj-lookup.config.js';

/** Cliente HTTP do microservice apps/cnpj-lookup (Python), que fala com o CNPJá. */
@Injectable()
export class CnpjLookupClient {
  private readonly logger = new Logger(CnpjLookupClient.name);

  constructor(private readonly config: CnpjLookupConfig) {}

  async consultaCnpj(cnpj: string): Promise<unknown> {
    const url = `${this.config.serviceBaseUrl}/v1/cnpj/${encodeURIComponent(cnpj)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err) {
      this.logger.error(`Falha ao chamar cnpj-lookup service para ${cnpj}`, err as Error);
      throw new HttpException('Serviço de consulta de CNPJ indisponível.', 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { detail?: string } | null;
      this.logger.warn(`cnpj-lookup service retornou ${response.status} para ${cnpj}`);
      throw new HttpException(body?.detail ?? 'Falha ao consultar CNPJ.', response.status);
    }

    return response.json();
  }
}
