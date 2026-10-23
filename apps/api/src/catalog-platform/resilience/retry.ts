export interface RetryOptions {
  /** Repetições além da primeira chamada (0 = uma chamada só). */
  retries: number;
  baseMs: number;
  /** Teto do backoff e também da espera aceita por `Retry-After`: acima disso falha em vez de segurar a requisição. */
  maxMs: number;
  isRetryable: (err: unknown) => { retry: boolean; retryAfterMs?: number };
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Repete `fn` com backoff exponencial e jitter total (`random × min(maxMs, base × 2^tentativa)`), respeitando `Retry-After` como
 * piso da espera. Para chamadas idempotentes: quem chama decide o que repetir em `isRetryable` (nunca escrita, nunca 4xx).
 * Propaga o ÚLTIMO erro ao esgotar as tentativas.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions): Promise<T> {
  const sleep = o.sleep ?? defaultSleep;
  const random = o.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= o.retries) throw err;
      const decision = o.isRetryable(err);
      if (!decision.retry) throw err;
      if (decision.retryAfterMs !== undefined && decision.retryAfterMs > o.maxMs) throw err;
      const jitter = random() * Math.min(o.maxMs, o.baseMs * 2 ** attempt);
      await sleep(Math.max(jitter, decision.retryAfterMs ?? 0));
    }
  }
}
