import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WhatsappInboundConsumer } from './inbound-consumer.service.js';
import type { WhatsappLinkService } from './link.service.js';

/**
 * Integração com Redis REAL: consumer group, ACK, DLQ e retomada. O vínculo em si é testado em
 * whatsapp-link.spec.ts; aqui o serviço é um dublê para isolar o transporte.
 * Só roda com WHATSAPP_TEST_REDIS_URL.
 */
const REDIS = process.env.WHATSAPP_TEST_REDIS_URL;

describe.skipIf(!REDIS)('WhatsappInboundConsumer (Redis stream, integração)', () => {
  const stream = `test:whatsapp-inbound:${randomUUID()}`;
  const dlq = `${stream}:dlq`;
  let redis: Redis;
  let consumer: WhatsappInboundConsumer;
  let handle: ReturnType<typeof vi.fn>;
  const envBackup = { ...process.env };

  const event = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(), type: 'whatsapp.order_code_received', version: 1, occurredAt: '2026-10-05T12:00:00.000Z',
    tenant: 'teste', source: 'whatsapp',
    data: { wamid: 'wamid.1', from: '5511987654321', code: 'OS-K7Q2-X9MA', sentAt: '2026-10-05T12:00:00.000Z' },
    ...over,
  });
  const publish = (e: unknown) => redis.xadd(stream, '*', 'data', typeof e === 'string' ? e : JSON.stringify(e));
  const until = async (cond: () => Promise<boolean> | boolean, ms = 8_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timeout aguardando condição');
  };
  const pending = async () => ((await redis.xpending(stream, 'fixer-api')) as [number])[0];

  beforeAll(async () => {
    process.env.REDIS_URL = REDIS;
    process.env.WHATSAPP_INBOUND_STREAM = stream;
    process.env.TENANT_SLUG = 'teste';
    redis = new Redis(REDIS!);
    handle = vi.fn().mockResolvedValue('linked');
    consumer = new WhatsappInboundConsumer({ handle, purgeProcessed: vi.fn().mockResolvedValue(0) } as unknown as WhatsappLinkService);
    await consumer.onModuleInit();
  });

  afterAll(async () => {
    await consumer.onApplicationShutdown();
    await redis.del(stream, dlq);
    redis.disconnect();
    process.env = envBackup;
  });

  it('evento válido chega ao serviço e é confirmado (nada fica pendente)', async () => {
    const e = event();
    await publish(e);
    await until(() => handle.mock.calls.length === 1);
    expect(handle.mock.calls[0]![0]).toMatchObject({ id: e.id, data: { code: 'OS-K7Q2-X9MA' } });
    await until(async () => (await pending()) === 0);
  });

  it('JSON inválido, contrato inválido, versão futura e outro tenant vão para a DLQ e são confirmados', async () => {
    const before = handle.mock.calls.length;
    await publish('{isso nao e json');
    await publish(event({ data: { wamid: 'x', from: 'abc', code: 'nope', sentAt: 'x' } }));
    await publish(event({ version: 2 }));
    await publish(event({ tenant: 'outra-oficina' }));
    await until(async () => (await redis.xlen(dlq)) === 4);
    const reasons = (await redis.xrange(dlq, '-', '+')).map(([, f]) => f[f.indexOf('reason') + 1]);
    expect(reasons.join('|')).toMatch(/JSON inválido/);
    expect(reasons.join('|')).toMatch(/contrato inválido/);
    expect(reasons.join('|')).toMatch(/versão 2/);
    expect(reasons.join('|')).toMatch(/tenant "outra-oficina"/);
    expect(handle.mock.calls.length).toBe(before); // nada disso chegou ao serviço
    await until(async () => (await pending()) === 0);
  });

  it('tipo de evento desconhecido é ignorado e confirmado (outro produtor pode usar o stream)', async () => {
    const before = handle.mock.calls.length;
    const dlqBefore = await redis.xlen(dlq);
    await publish(event({ type: 'whatsapp.algo_novo' }));
    await until(async () => (await pending()) === 0);
    expect(handle.mock.calls.length).toBe(before);
    expect(await redis.xlen(dlq)).toBe(dlqBefore);
  });

  it('falha transitória não confirma: a mensagem fica pendente para ser reentregue', async () => {
    handle.mockRejectedValueOnce(new Error('banco fora do ar'));
    await publish(event());
    await until(async () => (await pending()) === 1);
    expect(await redis.xlen(dlq)).toBe(4); // não foi para a DLQ: é transitório
  });
});
