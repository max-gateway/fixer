import { describe, expect, it, vi } from 'vitest';
import { makeEvent } from '../testing.js';
import { dedupKey, IngestService } from './ingest.service.js';

function setup(inboxInserted: boolean, suppressed = false) {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('INTO inbox')) return { rowCount: inboxInserted ? 1 : 0 };
      if (sql.includes('FROM suppressions')) return { rowCount: suppressed ? 1 : 0 };
      return { rowCount: 1, rows: [{ id: 'n-1', created_at: new Date('2026-10-04T12:00:00Z') }] };
    }),
  };
  const db = { tx: (fn: (c: typeof client) => unknown) => fn(client) };
  const cfg = { brand: { name: 'X', color: '#C2410C' }, webhooks: [], dispatch: { maxAttempts: { email: 8 } } };
  const bus = { publish: vi.fn() };
  return { client, bus, service: new IngestService(db as never, cfg as never, bus as never) };
}

const insertCall = (client: ReturnType<typeof setup>['client']) =>
  client.query.mock.calls.find((c) => c[0].includes('INTO notifications'))!;

describe('IngestService', () => {
  it('evento repetido é descartado sem criar notificações', async () => {
    const { client, service } = setup(false);
    expect(await service.ingest(makeEvent())).toEqual({ duplicate: true });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('cria uma notificação PENDING para o cliente', async () => {
    const { client, service } = setup(true);
    expect(await service.ingest(makeEvent())).toEqual({ duplicate: false, created: 1, suppressed: 0 });
    const params = insertCall(client)[1]!;
    expect(params[10]).toBe('PENDING');
    expect(params[0]).toBe(dedupKey(makeEvent().id, 'status.customer', 'email', 'joao@x.com'));
  });

  it('destinatário suprimido é registrado como SUPPRESSED', async () => {
    const { client, service } = setup(true, true);
    expect(await service.ingest(makeEvent())).toMatchObject({ created: 0, suppressed: 1 });
    expect(insertCall(client)[1]![10]).toBe('SUPPRESSED');
  });

  it('equipe recebe in-app já como SENT e é avisada em tempo real após o commit', async () => {
    const { client, bus, service } = setup(true);
    const e = makeEvent({ type: 'order.problem_reported', actor: { kind: 'customer' }, data: { body: 'barulho' } });
    expect(await service.ingest(e)).toMatchObject({ created: 2 }); // e-mail + in-app
    const inapp = client.query.mock.calls.filter((c) => c[0].includes('INTO notifications')).find((c) => c[1]![5] === 'inapp')!;
    expect(inapp[1]![10]).toBe('SENT');
    expect(bus.publish).toHaveBeenCalledWith(
      'ana@oficina.com',
      expect.objectContaining({ id: 'n-1', severity: 'warning', orderId: 'o1', orderNumber: 7, readAt: null }),
    );
  });

  it('evento duplicado não publica nada', async () => {
    const { bus, service } = setup(false);
    await service.ingest(makeEvent());
    expect(bus.publish).not.toHaveBeenCalled();
  });
});
