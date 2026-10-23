import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry.js';

const opts = (over: Record<string, unknown> = {}) => ({
  retries: 2,
  baseMs: 100,
  maxMs: 1000,
  isRetryable: (): { retry: boolean; retryAfterMs?: number } => ({ retry: true }),
  sleep: vi.fn().mockResolvedValue(undefined),
  random: () => 0.5,
  ...over,
});

describe('withRetry', () => {
  it('devolve o resultado sem dormir quando dá certo de primeira', async () => {
    const o = opts();
    await expect(withRetry(async () => 'ok', o)).resolves.toBe('ok');
    expect(o.sleep).not.toHaveBeenCalled();
  });

  it('repete e tem sucesso; passa o número da tentativa', async () => {
    const o = opts();
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok');
    await expect(withRetry(fn, o)).resolves.toBe('ok');
    expect(fn.mock.calls.map((c) => c[0])).toEqual([0, 1]);
    expect(o.sleep).toHaveBeenCalledTimes(1);
  });

  it('esgota as tentativas e propaga o ÚLTIMO erro', async () => {
    const o = opts({ retries: 2 });
    const fn = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockRejectedValueOnce(new Error('c'));
    await expect(withRetry(fn, o)).rejects.toThrow('c');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('erro não repetível sai na hora, sem dormir', async () => {
    const o = opts({ isRetryable: () => ({ retry: false }) });
    const fn = vi.fn().mockRejectedValue(new Error('4xx'));
    await expect(withRetry(fn, o)).rejects.toThrow('4xx');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(o.sleep).not.toHaveBeenCalled();
  });

  it('backoff exponencial com jitter total: random × min(maxMs, base × 2^tentativa)', async () => {
    const o = opts({ retries: 3, random: () => 0.5, baseMs: 100, maxMs: 250 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockRejectedValueOnce(new Error())
      .mockRejectedValueOnce(new Error())
      .mockResolvedValue('ok');
    await withRetry(fn, o);
    expect(o.sleep.mock.calls.map((c) => c[0])).toEqual([50, 100, 125]); // 0.5×100, 0.5×200, 0.5×min(250,400)
  });

  it('respeita Retry-After como piso da espera', async () => {
    const o = opts({ isRetryable: () => ({ retry: true, retryAfterMs: 800 }) });
    await withRetry(vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue('ok'), o);
    expect(o.sleep).toHaveBeenCalledWith(800);
  });

  it('Retry-After acima do teto (maxMs) não espera: propaga o erro em vez de travar a requisição', async () => {
    const o = opts({ isRetryable: () => ({ retry: true, retryAfterMs: 60_000 }) });
    const fn = vi.fn().mockRejectedValue(new Error('429'));
    await expect(withRetry(fn, o)).rejects.toThrow('429');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(o.sleep).not.toHaveBeenCalled();
  });

  it('retries = 0 chama uma vez só', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('x'));
    await expect(withRetry(fn, opts({ retries: 0 }))).rejects.toThrow('x');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
