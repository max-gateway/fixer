import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** Onde está o motor de custos (max-gateway/platform services/cost-engine) e a chave deste Fixer nele. */
@Injectable()
export class CostEngineConfig {
  readonly baseUrl = (process.env.COST_ENGINE_URL ?? '').replace(/\/+$/, '');
  readonly apiKey = process.env.COST_ENGINE_API_KEY ?? '';
  readonly timeoutMs = Number(process.env.COST_ENGINE_TIMEOUT_MS ?? 15_000);
  get enabled() {
    return this.baseUrl !== '' && this.apiKey !== '';
  }
}

/**
 * Cliente fino do cost-engine (docs/CONVENTIONS.md da plataforma: o produto mantém um cliente e nunca importa código de lá).
 * A chave fica só no servidor; o navegador fala com a API do Fixer. Erros do motor chegam com o status e a mensagem dele.
 */
@Injectable()
export class CostEngineClient {
  private readonly logger = new Logger(CostEngineClient.name);

  constructor(private readonly config: CostEngineConfig) {}

  get enabled() {
    return this.config.enabled;
  }

  async request<T>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown, actor?: string): Promise<T> {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('O motor de custos não está configurado neste Fixer (COST_ENGINE_URL e COST_ENGINE_API_KEY).');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': this.config.apiKey, ...(actor ? { 'x-actor': actor } : {}) },
        // GET nunca leva corpo.
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      this.logger.error(`cost-engine indisponível em ${method} ${path}: ${(err as Error).message}`);
      throw new HttpException('O motor de custos está indisponível agora. Tente de novo em instantes.', 502);
    } finally {
      clearTimeout(timeout);
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
    if (!res.ok) {
      if (res.status >= 500) this.logger.warn(`cost-engine respondeu ${res.status} em ${method} ${path}`);
      // 401 do motor é falha de configuração deste Fixer, não do usuário: vira 502 para não parecer "sessão expirada".
      const status = res.status === 401 ? 502 : res.status;
      throw new HttpException({ message: json?.error?.message ?? 'O motor de custos recusou a operação.', code: json?.error?.code, details: json?.error?.details }, status);
    }
    return json as T;
  }

  /** GET que trata 404 como ausência (ex.: nenhum perfil publicado ainda). */
  async find<T>(path: string): Promise<T | null> {
    try {
      return await this.request<T>('GET', path);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 404) return null;
      throw err;
    }
  }
}
