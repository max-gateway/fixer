import { HttpException } from '@nestjs/common';

/**
 * Erro devolvido pela plataforma de catálogo: envelope estável `{ error: { code, message, requestId } }` (openapi.yaml).
 * A mensagem da plataforma NÃO chega ao usuário: só o código decide o que o Fixer responde (`toHttpException`).
 */
export class PlatformError extends Error {
  constructor(
    readonly status: number,
    /** Código estável da plataforma (`search_unavailable`, `rate_limited`...); `internal` se o corpo não seguir o envelope. */
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'PlatformError';
  }

  /** Só falha da plataforma abre o disjuntor; 4xx (inclusive 429) é problema do pedido, não saúde do serviço. */
  get countsAsFailure(): boolean {
    return this.status >= 500;
  }
}

/** `Retry-After` em segundos inteiros → ms. Valor ausente, não numérico ou negativo é ignorado (a data HTTP não é usada pela plataforma). */
function retryAfterMs(header: string | null | undefined): number | undefined {
  if (header == null || !/^\d+$/.test(header.trim())) return undefined;
  return Number(header.trim()) * 1000;
}

export function parsePlatformError(status: number, body: unknown, retryAfterHeader: string | null | undefined): PlatformError {
  const e = (body as { error?: { code?: unknown; message?: unknown; requestId?: unknown } } | null)?.error;
  const code = typeof e?.code === 'string' ? e.code : 'internal';
  const message = typeof e?.message === 'string' ? e.message : `HTTP ${status}`;
  const requestId = typeof e?.requestId === 'string' ? e.requestId : undefined;
  return new PlatformError(status, code, message, requestId, retryAfterMs(retryAfterHeader));
}

const isNetworkError = (err: unknown): boolean =>
  err instanceof TypeError || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));

/** O que vale repetir: indisponibilidade transitória (503), limite de taxa (429) e falha de rede/timeout. Nunca 4xx nem 500. */
export function retryDecision(err: unknown): { retry: boolean; retryAfterMs?: number } {
  if (err instanceof PlatformError) {
    return err.status === 503 || err.status === 429 ? { retry: true, retryAfterMs: err.retryAfterMs } : { retry: false };
  }
  return isNetworkError(err) ? { retry: true } : { retry: false };
}

const UNAVAILABLE = 'Catálogo de peças indisponível no momento. Tente novamente em instantes.';

const BY_CODE: Record<string, { status: number; message: string }> = {
  search_unavailable: { status: 503, message: UNAVAILABLE },
  overloaded: { status: 503, message: UNAVAILABLE },
  rate_limited: { status: 429, message: 'Muitas buscas em pouco tempo. Aguarde um instante.' },
  window_too_deep: { status: 400, message: 'Resultados demais para listar: refine a busca.' },
  not_found: { status: 404, message: 'Peça não encontrada no catálogo.' },
  invalid_request: { status: 400, message: 'Busca inválida.' },
  unauthorized: { status: 401, message: 'Sua sessão expirou. Entre novamente.' },
  forbidden: { status: 403, message: 'Você não tem permissão para esta operação no catálogo.' },
};

/** Resposta ao usuário do Fixer. Erro de rede, timeout, disjuntor aberto ou bulkhead cheio = 503 rotulado; erro interno da plataforma = 502 sem vazar detalhe. */
export function toHttpException(err: unknown): HttpException {
  if (err instanceof PlatformError) {
    const mapped = BY_CODE[err.code];
    if (mapped) return new HttpException({ message: mapped.message, requestId: err.requestId }, mapped.status);
    return new HttpException({ message: 'Falha ao consultar o catálogo de peças.', requestId: err.requestId }, 502);
  }
  return new HttpException({ message: UNAVAILABLE }, 503);
}
