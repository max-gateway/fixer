import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PlatformError, parsePlatformError, retryDecision, toHttpException } from './platform-error.js';

const body = (code: string, message = 'm') => ({ error: { code, message, requestId: 'req-1' } });

describe('parsePlatformError', () => {
  it('lê código, mensagem e requestId do envelope estável', () => {
    const e = parsePlatformError(503, body('search_unavailable', 'mongot fora'), '5');
    expect(e).toBeInstanceOf(PlatformError);
    expect(e).toMatchObject({ status: 503, code: 'search_unavailable', requestId: 'req-1', retryAfterMs: 5000 });
  });

  it('corpo fora do envelope vira código internal, sem confiar no texto', () => {
    expect(parsePlatformError(500, '<html>oops</html>', null)).toMatchObject({ status: 500, code: 'internal' });
    expect(parsePlatformError(502, null, null)).toMatchObject({ code: 'internal' });
  });

  it('Retry-After inválido ou negativo é ignorado', () => {
    expect(parsePlatformError(429, body('rate_limited'), 'abc').retryAfterMs).toBeUndefined();
    expect(parsePlatformError(429, body('rate_limited'), '-3').retryAfterMs).toBeUndefined();
  });
});

describe('retryDecision (só o que é transitório e idempotente)', () => {
  it('503 e 429 repetem, respeitando Retry-After', () => {
    expect(retryDecision(parsePlatformError(503, body('search_unavailable'), '2'))).toEqual({ retry: true, retryAfterMs: 2000 });
    expect(retryDecision(parsePlatformError(429, body('rate_limited'), null))).toEqual({ retry: true, retryAfterMs: undefined });
  });

  it('erro de rede (sem status) repete', () => {
    expect(retryDecision(new TypeError('fetch failed'))).toEqual({ retry: true });
  });

  it('4xx e 500 não repetem', () => {
    for (const status of [400, 401, 403, 404, 422, 500]) {
      expect(retryDecision(parsePlatformError(status, body('invalid_request'), null)).retry).toBe(false);
    }
  });

  it('o disjuntor não abre por erro do chamador (4xx), só por falha da plataforma', () => {
    expect(parsePlatformError(404, body('not_found'), null).countsAsFailure).toBe(false);
    expect(parsePlatformError(429, body('rate_limited'), null).countsAsFailure).toBe(false);
    expect(parsePlatformError(503, body('search_unavailable'), null).countsAsFailure).toBe(true);
    expect(parsePlatformError(500, body('internal'), null).countsAsFailure).toBe(true);
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
    const ex = toHttpException(parsePlatformError(status, body(code), null));
    expect(ex).toBeInstanceOf(HttpException);
    expect(ex.getStatus()).toBe(expected);
    expect(JSON.stringify(ex.getResponse()).toLowerCase()).toContain(fragment.toLowerCase());
  });

  it('erro interno da plataforma vira 502 e não vaza a mensagem dela', () => {
    const ex = toHttpException(parsePlatformError(500, body('internal', 'stack: segredo'), null));
    expect(ex.getStatus()).toBe(502);
    expect(JSON.stringify(ex.getResponse())).not.toContain('segredo');
  });

  it('erro de rede vira 503 rotulado', () => {
    expect(toHttpException(new TypeError('fetch failed')).getStatus()).toBe(503);
  });
});
