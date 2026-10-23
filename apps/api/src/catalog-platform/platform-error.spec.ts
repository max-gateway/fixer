import { CatalogApiError } from '@max-gateway/catalog-client';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BulkheadFullError } from './resilience/bulkhead.js';
import { CircuitOpenError } from './resilience/circuit-breaker.js';
import { retryDecision, toHttpException } from './platform-error.js';

const err = (status: number, code: string, requestId = 'req-1', retryAfterMs?: number) => new CatalogApiError(status, code, 'mensagem da plataforma', requestId, retryAfterMs);

describe('retryDecision (só o que é transitório e idempotente)', () => {
  it('503 e 429 repetem, respeitando Retry-After', () => {
    expect(retryDecision(err(503, 'search_unavailable', 'r', 2000))).toEqual({ retry: true, retryAfterMs: 2000 });
    expect(retryDecision(err(429, 'rate_limited'))).toEqual({ retry: true, retryAfterMs: undefined });
  });

  it('erro de rede e tempo esgotado (sem status) repetem', () => {
    expect(retryDecision(new TypeError('fetch failed'))).toEqual({ retry: true });
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    expect(retryDecision(timeout)).toEqual({ retry: true });
    const abort = new Error('abort');
    abort.name = 'AbortError';
    expect(retryDecision(abort)).toEqual({ retry: true });
  });

  it('4xx e 500 não repetem', () => {
    for (const status of [400, 401, 403, 404, 422, 500]) {
      expect(retryDecision(err(status, 'invalid_request')).retry).toBe(false);
    }
  });

  it('disjuntor aberto e bulkhead cheio não repetem (repetir é o que eles existem para evitar)', () => {
    expect(retryDecision(new CircuitOpenError()).retry).toBe(false);
    expect(retryDecision(new BulkheadFullError()).retry).toBe(false);
  });

  it('defeito de programação (erro qualquer) não repete', () => {
    expect(retryDecision(new RangeError('bug')).retry).toBe(false);
  });
});

describe('toHttpException (o que o usuário do Fixer recebe)', () => {
  const cases: Array<[string, number, number, string]> = [
    ['search_unavailable', 503, 503, 'indisponível'],
    ['overloaded', 503, 503, 'indisponível'],
    ['rate_limited', 429, 429, 'Muitas'],
    ['window_too_deep', 400, 400, 'resultados'],
    ['not_found', 404, 404, 'não encontrada'],
    ['invalid_request', 400, 400, ''],
    ['unauthorized', 401, 401, 'sessão'],
    ['forbidden', 403, 403, 'permissão'],
  ];
  it.each(cases)('%s (%i) → %i', (code, status, expected, fragment) => {
    const ex = toHttpException(err(status, code));
    expect(ex).toBeInstanceOf(HttpException);
    expect(ex.getStatus()).toBe(expected);
    expect(JSON.stringify(ex.getResponse()).toLowerCase()).toContain(fragment.toLowerCase());
  });

  it('leva o requestId da plataforma para o suporte rastrear', () => {
    expect(JSON.stringify(toHttpException(err(404, 'not_found', 'req-xyz')).getResponse())).toContain('req-xyz');
  });

  it('erro interno da plataforma vira 502 e não vaza a mensagem dela', () => {
    const ex = toHttpException(new CatalogApiError(500, 'internal', 'stack: segredo', 'req-1'));
    expect(ex.getStatus()).toBe(502);
    expect(JSON.stringify(ex.getResponse())).not.toContain('segredo');
  });

  it('código que o Fixer não conhece também não vaza a mensagem', () => {
    const ex = toHttpException(new CatalogApiError(418, 'bule', 'texto interno', 'req-1'));
    expect(ex.getStatus()).toBe(502);
    expect(JSON.stringify(ex.getResponse())).not.toContain('texto interno');
  });

  it('erro de rede, tempo esgotado, disjuntor aberto e bulkhead cheio viram 503 rotulado', () => {
    for (const e of [new TypeError('fetch failed'), new CircuitOpenError(), new BulkheadFullError()]) {
      expect(toHttpException(e).getStatus()).toBe(503);
    }
  });

  it('defeito de programação sobe como está (não é resultado da plataforma)', () => {
    const bug = new RangeError('bug');
    expect(() => {
      throw toHttpException(bug);
    }).toThrow(bug);
  });
});
