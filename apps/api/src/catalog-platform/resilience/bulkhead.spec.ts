import { describe, expect, it } from 'vitest';
import { Bulkhead, BulkheadFullError } from './bulkhead.js';

const gate = () => {
  let release!: (v?: string) => void;
  const p = new Promise<string>((r) => (release = (v = 'ok') => r(v)));
  return { p, release };
};

describe('Bulkhead', () => {
  it('executa até o limite em paralelo e recusa o excedente na hora (sem fila)', async () => {
    const b = new Bulkhead({ maxConcurrent: 2 });
    const a = gate();
    const c = gate();
    const r1 = b.exec(() => a.p);
    const r2 = b.exec(() => c.p);
    await expect(b.exec(async () => 'x')).rejects.toBeInstanceOf(BulkheadFullError);
    a.release();
    c.release();
    await Promise.all([r1, r2]);
  });

  it('libera a vaga também quando a chamada falha', async () => {
    const b = new Bulkhead({ maxConcurrent: 1 });
    await expect(b.exec(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(b.exec(async () => 'livre')).resolves.toBe('livre');
    expect(b.inFlight).toBe(0);
  });

  it('com fila, enfileira em ordem FIFO até maxQueue e recusa além disso', async () => {
    const b = new Bulkhead({ maxConcurrent: 1, maxQueue: 1 });
    const order: string[] = [];
    const g = gate();
    const first = b.exec(async () => (order.push('1'), g.p));
    const second = b.exec(async () => (order.push('2'), 'dois'));
    await expect(b.exec(async () => 'x')).rejects.toBeInstanceOf(BulkheadFullError);
    expect(order).toEqual(['1']);
    g.release();
    await first;
    await expect(second).resolves.toBe('dois');
    expect(order).toEqual(['1', '2']);
  });
});
