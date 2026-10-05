import { describe, expect, it, vi } from 'vitest';
import { DeliveryError } from '../channels/channel.js';
import { backoffMs, Dispatcher } from './dispatcher.service.js';

describe('backoffMs', () => {
  it('cresce exponencialmente, com jitter, e respeita o teto', () => {
    expect(backoffMs(1, 1000, 60_000, () => 0)).toBe(500);
    expect(backoffMs(1, 1000, 60_000, () => 1)).toBe(1000);
    expect(backoffMs(3, 1000, 60_000, () => 1)).toBe(4000);
    expect(backoffMs(20, 1000, 60_000, () => 1)).toBe(60_000);
  });
});

function setup(send: () => Promise<{ providerMessageId?: string }>, row: Partial<{ attempts: number; max_attempts: number }> = {}) {
  const claimed = { id: 'n1', event_id: 'e1', channel: 'email', recipient: 'a@b.c', message: {}, attempts: 1, max_attempts: 3, ...row };
  const query = vi.fn().mockResolvedValueOnce({ rows: [claimed] }).mockResolvedValue({ rows: [] });
  const metrics = { sent: { inc: vi.fn() }, sendDuration: { startTimer: () => () => 0 }, breakerState: { set: vi.fn() } };
  const cfg = { dispatch: { batchSize: 5, leaseMs: 1000, backoffBaseMs: 1000, backoffCapMs: 5000, breaker: { threshold: 2, cooldownMs: 1000, maxCooldownMs: 4000 } } };
  const d = new Dispatcher({ query } as never, { get: () => ({ send }), names: () => ['email'] } as never, metrics as never, cfg as never);
  return { d, query, metrics };
}
const lastUpdate = (q: ReturnType<typeof vi.fn>) => q.mock.calls.at(-1)!;

describe('Dispatcher.tick', () => {
  it('sucesso -> SENT', async () => {
    const { d, query, metrics } = setup(async () => ({ providerMessageId: 'm1' }));
    await d.tick();
    expect(lastUpdate(query)[0]).toContain("status = 'SENT'");
    expect(metrics.sent.inc).toHaveBeenCalledWith({ channel: 'email', result: 'sent' });
  });

  it('erro transitório -> volta para PENDING com backoff', async () => {
    const { d, query } = setup(async () => {
      throw new DeliveryError('timeout', true);
    });
    await d.tick();
    expect(lastUpdate(query)[1].slice(1, 3)).toEqual(['PENDING', 'timeout']);
  });

  it('erro permanente -> DEAD na primeira tentativa', async () => {
    const { d, query } = setup(async () => {
      throw new DeliveryError('HTTP 400', false);
    });
    await d.tick();
    expect(lastUpdate(query)[1][1]).toBe('DEAD');
  });

  it('última tentativa esgotada -> DEAD', async () => {
    const { d, query } = setup(
      async () => {
        throw new DeliveryError('timeout', true);
      },
      { attempts: 3 },
    );
    await d.tick();
    expect(lastUpdate(query)[1][1]).toBe('DEAD');
  });
});

describe('Dispatcher + circuit breaker', () => {
  it('abre o circuito do canal e para de reivindicar', async () => {
    const claimed = { id: 'n1', event_id: 'e1', channel: 'email', recipient: 'a@b.c', message: {}, attempts: 1, max_attempts: 9 };
    const query = vi.fn(async (sql: string) => (sql.includes('RETURNING') ? { rows: [claimed] } : { rows: [] }));
    const metrics = { sent: { inc: vi.fn() }, sendDuration: { startTimer: () => () => 0 }, breakerState: { set: vi.fn() } };
    const send = async () => {
      throw new DeliveryError('down', true);
    };
    const cfg = { dispatch: { batchSize: 5, leaseMs: 1000, backoffBaseMs: 1000, backoffCapMs: 5000, breaker: { threshold: 2, cooldownMs: 60_000, maxCooldownMs: 60_000 } } };
    const d = new Dispatcher({ query } as never, { get: () => ({ send }), names: () => ['email'] } as never, metrics as never, cfg as never);

    expect(await d.tick()).toBe(1);
    expect(await d.tick()).toBe(1); // 2ª falha: abre
    const claims = () => query.mock.calls.filter(([sql]) => sql.includes('RETURNING')).length;
    const before = claims();
    expect(await d.tick()).toBe(0); // circuito aberto: nem consulta a fila
    expect(claims()).toBe(before);
    expect(metrics.breakerState.set).toHaveBeenLastCalledWith({ channel: 'email' }, 2);
  });
});
