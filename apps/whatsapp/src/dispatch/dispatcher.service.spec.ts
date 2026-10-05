import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config.js';
import { ProviderError } from '../provider/provider.js';
import { Dispatcher } from './dispatcher.service.js';

const cfg = loadConfig({
  WHATSAPP_DATABASE_URL: 'x',
  WHATSAPP_API_KEYS: 'k'.repeat(20),
} as never);
const claimed: Record<string, unknown> = {
  id: 'm1',
  to_phone: '5511987654321',
  kind: 'TEMPLATE',
  template: 'os_portal_link',
  language: 'pt_BR',
  variables: ['1', 'a', 'b'],
  body: null,
  attempts: 1,
  max_attempts: 8,
};

function setup(
  send: () => Promise<{ wamid: string }>,
  contact?: { opt_status: string; last_inbound_at: Date | null },
  row: Record<string, unknown> = claimed,
) {
  const updates: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: [row] };
    if (sql.includes('FROM contacts'))
      return { rows: contact ? [contact] : [] };
    updates.push({ sql, params });
    return { rows: [] };
  });
  const metrics = {
    breakerState: { set: vi.fn() },
    attempts: { inc: vi.fn() },
    sendDuration: { startTimer: () => () => 0 },
  };
  const provider = { send: vi.fn(send) };
  const d = new Dispatcher(
    { query } as never,
    metrics as never,
    provider as never,
    cfg,
  );
  return { d, updates, provider, metrics };
}

describe('Dispatcher.tick', () => {
  it('envio ok grava wamid e marca SENT sem regredir status avançado por webhook', async () => {
    const { d, updates } = setup(async () => ({ wamid: 'wamid.1' }));
    expect(await d.tick()).toBe(1);
    expect(updates[0].params).toEqual(['m1', 'wamid.1']);
    expect(updates[0].sql).toContain(
      "CASE WHEN status = 'SENDING' THEN 'SENT' ELSE status END",
    );
  });

  it('erro transitório volta para QUEUED com backoff; permanente vai para DEAD', async () => {
    const transient = setup(async () => {
      throw new ProviderError('HTTP 503', true, '1');
    });
    await transient.d.tick();
    expect(transient.updates[0].params.slice(0, 2)).toEqual(['m1', 'QUEUED']);

    const permanent = setup(async () => {
      throw new ProviderError('undeliverable', false, '131026');
    });
    await permanent.d.tick();
    expect(permanent.updates[0].params.slice(0, 4)).toEqual([
      'm1',
      'DEAD',
      'undeliverable',
      '131026',
    ]);
  });

  it('esgotou max_attempts: DEAD mesmo sendo transitório', async () => {
    const { d, updates } = setup(
      async () => {
        throw new ProviderError('HTTP 500', true);
      },
      undefined,
      { ...claimed, attempts: 8 },
    );
    await d.tick();
    expect(updates[0].params[1]).toBe('DEAD');
  });

  it('opt-out no momento do envio: suprime sem chamar o provedor', async () => {
    const { d, updates, provider } = setup(async () => ({ wamid: 'x' }), {
      opt_status: 'OPTED_OUT',
      last_inbound_at: null,
    });
    await d.tick();
    expect(provider.send).not.toHaveBeenCalled();
    expect(updates[0].sql).toContain("'SUPPRESSED'");
  });

  it('texto fora da janela de 24h é falha permanente, sem chamar o provedor', async () => {
    const row = { ...claimed, kind: 'TEXT', template: null, body: 'oi' };
    const { d, updates, provider } = setup(
      async () => ({ wamid: 'x' }),
      {
        opt_status: 'OPTED_IN',
        last_inbound_at: new Date(Date.now() - 30 * 3_600_000),
      },
      row,
    );
    await d.tick();
    expect(provider.send).not.toHaveBeenCalled();
    expect(updates[0].params.slice(0, 2)).toEqual(['m1', 'DEAD']);
  });

  it('circuit breaker abre após falhas seguidas e para de martelar o provedor', async () => {
    const { d, provider } = setup(async () => {
      throw new ProviderError('HTTP 503', true);
    });
    for (let i = 0; i < cfg.dispatch.breaker.threshold; i++) await d.tick();
    const calls = provider.send.mock.calls.length;
    expect(await d.tick()).toBe(0);
    expect(provider.send.mock.calls.length).toBe(calls);
  });
});
