import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

const opts = { threshold: 3, cooldownMs: 1000, maxCooldownMs: 4000 };

function setup() {
  let t = 0;
  const b = new CircuitBreaker(opts, () => t);
  return { b, advance: (ms: number) => (t += ms) };
}

describe('CircuitBreaker', () => {
  it('abre após N falhas transitórias consecutivas', () => {
    const { b } = setup();
    b.onTransientFailure();
    b.onTransientFailure();
    expect(b.state).toBe('closed');
    b.onTransientFailure();
    expect(b.state).toBe('open');
    expect(b.allowance(20)).toBe(0);
  });

  it('um sucesso zera a contagem', () => {
    const { b } = setup();
    b.onTransientFailure();
    b.onTransientFailure();
    b.onSuccess();
    b.onTransientFailure();
    expect(b.state).toBe('closed');
  });

  it('half-open libera uma única sonda; sucesso fecha', () => {
    const { b, advance } = setup();
    for (let i = 0; i < 3; i++) b.onTransientFailure();
    advance(1000);
    expect(b.state).toBe('half-open');
    expect(b.allowance(20)).toBe(1);
    b.beginProbe();
    expect(b.allowance(20)).toBe(0);
    b.onSuccess();
    expect(b.state).toBe('closed');
    expect(b.allowance(20)).toBe(20);
  });

  it('falha na sonda reabre com cooldown dobrado, até o teto', () => {
    const { b, advance } = setup();
    for (let i = 0; i < 3; i++) b.onTransientFailure();
    advance(1000);
    b.beginProbe();
    b.onTransientFailure();
    expect(b.state).toBe('open');
    advance(1999);
    expect(b.state).toBe('open');
    advance(1);
    expect(b.state).toBe('half-open');
    b.beginProbe();
    b.onTransientFailure(); // 4000 (teto)
    advance(3999);
    expect(b.state).toBe('open');
  });

  it('falha permanente não abre o circuito', () => {
    const { b } = setup();
    for (let i = 0; i < 10; i++) b.onPermanentFailure();
    expect(b.state).toBe('closed');
  });
});
