import { CatalogApiError } from '@max-gateway/catalog-client';
import { HttpException } from '@nestjs/common';
import { BulkheadFullError } from './resilience/bulkhead.js';
import { CircuitOpenError } from './resilience/circuit-breaker.js';

/** Falha de rede ou tempo esgotado: a chamada não obteve resposta da plataforma. */
export const isNetworkError = (err: unknown): boolean =>
  err instanceof TypeError || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));

/**
 * O que vale repetir: indisponibilidade transitória (503), limite de taxa (429) e falha de rede/timeout. Nunca 4xx nem 500, nem disjuntor aberto
 * ou bulkhead cheio (repetir é o que eles existem para evitar), nem defeito de programação.
 */
export function retryDecision(err: unknown): { retry: boolean; retryAfterMs?: number } {
  if (err instanceof CatalogApiError) {
    return err.status === 503 || err.status === 429 ? { retry: true, retryAfterMs: err.retryAfterMs } : { retry: false };
  }
  return isNetworkError(err) ? { retry: true } : { retry: false };
}

/** O que conta como falha da plataforma para o disjuntor: 5xx e falta de resposta. Erro do pedido (4xx) e defeito do Fixer não contam. */
export const countsAsPlatformFailure = (err: unknown): boolean => (err instanceof CatalogApiError ? err.countsAsFailure : isNetworkError(err));

const UNAVAILABLE = 'Catálogo de peças indisponível no momento. Tente novamente em instantes.';

const BY_CODE: Record<string, { status: number; message: string }> = {
  search_unavailable: { status: 503, message: UNAVAILABLE },
  overloaded: { status: 503, message: UNAVAILABLE },
  rate_limited: { status: 429, message: 'Muitas buscas em pouco tempo. Aguarde um instante.' },
  window_too_deep: { status: 400, message: 'Resultados demais para listar: refine a busca.' },
  not_found: { status: 404, message: 'Peça não encontrada no catálogo.' },
  invalid_request: { status: 400, message: 'Busca inválida.' },
  // A plataforma recusou um token que o Fixer JÁ aceitou: a sessão da pessoa está boa; o problema é emissor, audiência ou organização não registrada.
  // Responder 401 mandaria o web pedir login de novo em loop, e dizer "sessão expirou" mandaria a pessoa na direção errada.
  unauthorized: { status: 502, message: 'O catálogo de peças não reconheceu o seu login (configuração de identidade). Não é a sua sessão: avise o suporte.' },
  forbidden: { status: 403, message: 'Você não tem permissão para esta operação no catálogo.' },
};

/**
 * Resposta ao usuário do Fixer. A mensagem da plataforma NÃO chega a ele: só o código estável decide. Erro de rede, tempo esgotado, disjuntor
 * aberto e bulkhead cheio = 503 rotulado; erro interno ou código desconhecido da plataforma = 502 sem vazar detalhe. Defeito de programação sobe como está.
 */
export function toHttpException(err: unknown): HttpException {
  if (err instanceof CatalogApiError) {
    const mapped = BY_CODE[err.code];
    if (mapped) return new HttpException({ message: mapped.message, requestId: err.requestId }, mapped.status);
    return new HttpException({ message: 'Falha ao consultar o catálogo de peças.', requestId: err.requestId }, 502);
  }
  if (err instanceof CircuitOpenError || err instanceof BulkheadFullError || isNetworkError(err)) {
    return new HttpException({ message: UNAVAILABLE }, 503);
  }
  throw err;
}
