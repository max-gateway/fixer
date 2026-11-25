import { HttpException, Injectable, Logger } from '@nestjs/common';
import { CnpjLookupConfig } from './cnpj-lookup.config.js';

/**
 * Corpo de erro das duas formas de chegar ao serviço: o próprio serviço responde `{ detail }` (FastAPI) e a borda comercial da
 * plataforma responde `{ error: { code, message, requestId } }`.
 */
interface UpstreamErrorBody {
  detail?: unknown;
  error?: { code?: unknown; message?: unknown; requestId?: unknown };
}

const UNAVAILABLE = 'Serviço de consulta de CNPJ indisponível.';
const LIMIT_REACHED = 'Limite de consultas de CNPJ atingido. Tente novamente em instantes.';

/** Cliente HTTP do serviço de consulta de CNPJ da plataforma (cnpj-lookup), que fala com o CNPJá. Direto ou pela borda comercial, por configuração. */
@Injectable()
export class CnpjLookupClient {
  private readonly logger = new Logger(CnpjLookupClient.name);

  constructor(private readonly config: CnpjLookupConfig) {}

  async consultaCnpj(cnpj: string): Promise<unknown> {
    const url = `${this.config.serviceBaseUrl}/v1/cnpj/${encodeURIComponent(cnpj)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const headers: Record<string, string> = this.config.apiKey ? { 'X-Api-Key': this.config.apiKey } : {};

    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } catch (err) {
      this.logger.error(`Falha ao chamar cnpj-lookup service para ${cnpj}`, err as Error);
      throw new HttpException(UNAVAILABLE, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw await this.failure(response, cnpj);

    return response.json();
  }

  private async failure(response: Response, cnpj: string): Promise<HttpException> {
    const body = (await response.json().catch(() => null)) as UpstreamErrorBody | null;
    const edge = typeof body?.error?.code === 'string' ? body.error : undefined;
    const status = response.status;
    this.logger.warn(`cnpj-lookup service retornou ${status}${edge ? ` (${String(edge.code)}, requestId ${String(edge.requestId ?? '-')})` : ''} para ${cnpj}`);

    if (edge) {
      // A borda recusa por motivos que são NOSSOS (chave do Fixer inválida, plano sem acesso, conta suspensa): o usuário da oficina
      // não tem culpa. Um 401 repassado deslogaria a pessoa, então vira 502, e a causa fica no log acima.
      if (status === 401 || status === 403) throw new HttpException(UNAVAILABLE, 502);
      // Cota do plano ou limite por minuto: o aviso é seguro e útil.
      if (status === 429) throw new HttpException(LIMIT_REACHED, 429);
      // Falha de infraestrutura da borda: nada do que ela diz ajuda a oficina.
      if (status >= 500) throw new HttpException(UNAVAILABLE, status);
      throw new HttpException(typeof edge.message === 'string' ? edge.message : 'Falha ao consultar CNPJ.', status);
    }

    // Resposta do próprio serviço (`detail`): comportamento de sempre.
    throw new HttpException(typeof body?.detail === 'string' ? body.detail : 'Falha ao consultar CNPJ.', status);
  }
}
