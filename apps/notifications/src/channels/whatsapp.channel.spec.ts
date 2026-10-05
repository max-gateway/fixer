import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryError } from './channel.js';
import { WhatsAppChannel } from './whatsapp.channel.js';

const ch = new WhatsAppChannel({ url: 'http://wa:3006/', apiKey: 'k'.repeat(20) });
const n = { id: 'n-1', eventId: 'e-1', recipient: '11987654321', message: { body: { type: 'template', template: 'os_portal_link', variables: ['1', 'a', 'b'] } } };
const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

afterEach(() => vi.unstubAllGlobals());

describe('WhatsAppChannel', () => {
  it('enfileira no serviço com Idempotency-Key derivada da notificação e devolve o id', async () => {
    const f = vi.fn().mockResolvedValue(res(202, { id: 'msg-9' }));
    vi.stubGlobal('fetch', f);
    expect(await ch.send(n)).toEqual({ providerMessageId: 'msg-9' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://wa:3006/v1/messages');
    expect(init.headers['idempotency-key']).toBe('notif-n-1');
    expect(JSON.parse(init.body)).toMatchObject({ to: '11987654321', template: 'os_portal_link' });
  });

  it.each([
    [422, false],
    [409, false],
    [400, false],
    [500, true],
    [429, true],
    [401, true],
  ])('HTTP %i -> retryable=%s', async (status, retryable) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status, { message: 'x' })));
    await expect(ch.send(n)).rejects.toMatchObject({ retryable });
  });

  it('falha de rede é transitória', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const err = await ch.send(n).catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.retryable).toBe(true);
  });
});
