import { describe, expect, it, vi } from 'vitest';
import { BreakerRegistry, CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

function make(over: Record<string, unknown> = {}) {
  let t = 0;
  const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 10_000, now: () => t, ...over });
  return { cb, advance: (ms: number) => (t += ms) };
}
const fail = () => Promise.reject(new Error('boom'));
const ok = () => Promise.resolve('ok');

describe('CircuitBreaker', () => {
  it('fechado: repassa o resultado e o erro', async () => {
    const { cb } = make();
    await expect(cb.exec(ok)).resolves.toBe('ok');
    await expect(cb.exec(fail)).rejects.toThrow('boom');
    expect(cb.state).toBe('closed');
  });

  it('abre após N falhas CONSECUTIVAS e passa a recusar sem chamar', async () => {
    const { cb } = make();
    for (let i = 0; i < 3; i++) await cb.exec(fail).catch(() => undefined);
    expect(cb.state).toBe('open');
    const fn = vi.fn(ok);
    await expect(cb.exec(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('um sucesso zera a contagem de falhas', async () => {
    const { cb } = make();
    await cb.exec(fail).catch(() => undefined);
    await cb.exec(fail).catch(() => undefined);
    await cb.exec(ok);
    await cb.exec(fail).catch(() => undefined);
    await cb.exec(fail).catch(() => undefined);
    expect(cb.state).toBe('closed');
  });

  it('depois de openMs deixa passar UMA sonda (meio aberto); sucesso fecha', async () => {
    const { cb, advance } = make();
    for (let i = 0; i < 3; i++) await cb.exec(fail).catch(() => undefined);
    advance(10_000);
    await expect(cb.exec(ok)).resolves.toBe('ok');
    expect(cb.state).toBe('closed');
  });

  it('falha da sonda reabre e reinicia a espera', async () => {
    const { cb, advance } = make();
    for (let i = 0; i < 3; i++) await cb.exec(fail).catch(() => undefined);
    advance(10_000);
    await cb.exec(fail).catch(() => undefined);
    expect(cb.state).toBe('open');
    advance(9_999);
    await expect(cb.exec(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('meio aberto admite só uma sonda por vez', async () => {
    const { cb, advance } = make();
    for (let i = 0; i < 3; i++) await cb.exec(fail).catch(() => undefined);
    advance(10_000);
    let release!: () => void;
    const slow = cb.exec(() => new Promise<string>((r) => (release = () => r('ok'))));
    await expect(cb.exec(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    await slow;
  });

  it('erro do chamador (isFailure=false) não conta e não abre', async () => {
    const { cb } = make({ isFailure: (e: unknown) => (e as Error).message !== 'client' });
    for (let i = 0; i < 10; i++) await cb.exec(() => Promise.reject(new Error('client'))).catch(() => undefined);
    expect(cb.state).toBe('closed');
  });
});

describe('BreakerRegistry', () => {
  it('um disjuntor por chave: a falha de uma organização não afeta a outra', async () => {
    const reg = new BreakerRegistry({ failureThreshold: 1, openMs: 10_000 });
    await reg.for('org-a').exec(fail).catch(() => undefined);
    expect(reg.for('org-a').state).toBe('open');
    expect(reg.for('org-b').state).toBe('closed');
    expect(reg.for('org-a')).toBe(reg.for('org-a'));
  });
});
