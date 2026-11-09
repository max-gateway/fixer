import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { MarketplaceConfig, type MarketplaceSettings } from './marketplace.config.js';

/** Token de injeção do `fetch` (só os testes o trocam). */
export const MARKETPLACE_FETCH = Symbol('MARKETPLACE_FETCH');

/** O serviço respondeu com erro do padrão da plataforma: `{ error: { code, message } }`. */
export class MarketplaceRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Erro do serviço → resposta à pessoa. Recusas de regra (4xx) levam a mensagem do serviço, escrita para pessoas; o resto vira indisponibilidade. */
export function toHttpException(err: unknown): HttpException {
  if (err instanceof HttpException) return err;
  if (err instanceof MarketplaceRequestError && [400, 403, 404, 409, 422].includes(err.status)) {
    return new HttpException({ message: err.status === 404 ? 'Não encontrado.' : err.message }, err.status);
  }
  return new HttpException({ message: 'O serviço de marketplaces está indisponível. Tente de novo em instantes.' }, 503);
}

/** Único ponto do Fixer que fala com o serviço `marketplace`: token de serviço em cache e a organização em `X-Org-Id`. */
@Injectable()
export class MarketplaceClient {
  private token?: { value: string; until: number };

  constructor(
    @Inject(MarketplaceConfig) private readonly cfg: MarketplaceSettings,
    @Optional() @Inject(MARKETPLACE_FETCH) private readonly http: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  async request<T>(orgId: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await this.send(orgId, method, path, body, await this.accessToken());
    if (res.status !== 401) return this.read<T>(res);
    // Token revogado ou chave rotacionada antes de vencer: descarta e tenta uma vez com outro.
    this.token = undefined;
    return this.read<T>(await this.send(orgId, method, path, body, await this.accessToken()));
  }

  private send(orgId: string, method: string, path: string, body: unknown, token: string): Promise<Response> {
    return this.http(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'x-org-id': orgId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
  }

  private async read<T>(res: Response): Promise<T> {
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!res.ok) throw new MarketplaceRequestError(res.status, json.error?.code ?? 'error', json.error?.message ?? `HTTP ${res.status}`);
    return json as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const res = await this.http(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) throw new MarketplaceRequestError(502, 'token', 'Não foi possível obter o token do serviço');
    this.token = { value: json.access_token, until: Date.now() + Math.max(0, (json.expires_in ?? 60) - 30) * 1000 };
    return json.access_token;
  }
}
