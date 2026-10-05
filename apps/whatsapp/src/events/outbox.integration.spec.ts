import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config.js';
import { Database } from '../db/database.service.js';
import { Metrics } from '../health/metrics.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { EventOutbox } from './event-outbox.js';
import { EventRelay } from './outbox-relay.service.js';

/**
 * Integração com Postgres e Redis REAIS: webhook da Meta -> outbox transacional -> Redis Stream.
 * Só roda com WHATSAPP_TEST_DATABASE_URL e WHATSAPP_TEST_REDIS_URL (use um banco descartável; o
 * teste cria o schema "whatsapp" se faltar e remove só as linhas que ele mesmo criou).
 */
const DB = process.env.WHATSAPP_TEST_DATABASE_URL;
const REDIS = process.env.WHATSAPP_TEST_REDIS_URL;

describe.skipIf(!DB || !REDIS)('webhook -> outbox -> Redis Stream (integração)', () => {
  const stream = `test:whatsapp-inbound:${randomUUID()}`;
  const phone = `5511${Math.floor(900000000 + Math.random() * 99999999)}`;
  let db: Database;
  let webhooks: WebhooksService;
  let relay: EventRelay;
  let redis: Redis;

  const payload = (wamid: string, body: string) => ({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: wamid, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }] } }] }],
  });
  const outboxRows = () => db.query<{ published_at: Date | null; payload: { data: { code: string; from: string } } }>('SELECT published_at, payload FROM event_outbox WHERE subject = $1 ORDER BY seq', [phone]);

  beforeAll(async () => {
    const cfg = loadConfig({
      WHATSAPP_DATABASE_URL: DB!,
      WHATSAPP_API_KEYS: 'chave-de-teste-1234567890',
      REDIS_URL: REDIS!,
      INBOUND_EVENTS_STREAM: stream,
      TENANT_SLUG: 'teste',
      ORDER_CODE_MAX_PER_WINDOW: '3',
    } as NodeJS.ProcessEnv);
    db = new Database(cfg);
    await db.onModuleInit(); // aplica as migrations de verdade
    webhooks = new WebhooksService(db, new Metrics(db), new EventOutbox(cfg));
    relay = new EventRelay(db, cfg);
    redis = new Redis(REDIS!);
    (relay as unknown as { redis: Redis }).redis = redis; // sem o loop em segundo plano: publicamos à mão
  });

  afterAll(async () => {
    await db.query('DELETE FROM event_outbox WHERE subject = $1', [phone]);
    await db.query('DELETE FROM inbound_messages WHERE from_phone = $1', [phone]);
    await db.query('DELETE FROM contacts WHERE phone = $1', [phone]);
    await redis.del(stream);
    redis.disconnect();
    await db.onApplicationShutdown();
  });

  it('mensagem com código vira exatamente um evento, mesmo se a Meta reentregar o webhook', async () => {
    await webhooks.handle(payload('wamid.A', 'Olá! Quero acompanhar minha OS pelo WhatsApp. Código: os k7q2 x9ma'));
    await webhooks.handle(payload('wamid.A', 'Olá! Quero acompanhar minha OS pelo WhatsApp. Código: os k7q2 x9ma'));
    const { rows } = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.data).toMatchObject({ code: 'OS-K7Q2-X9MA', from: phone });
    expect(rows[0]!.published_at).toBeNull();
  });

  it('mensagem sem código não gera evento (só conta como conversa)', async () => {
    await webhooks.handle(payload('wamid.B', 'bom dia, tudo bem?'));
    expect((await outboxRows()).rows).toHaveLength(1);
  });

  it('o relay publica no stream com o envelope v1 e marca como publicado; segunda rodada não repete', async () => {
    expect(await relay.publishBatch()).toBeGreaterThanOrEqual(1);
    const entries = await redis.xrange(stream, '-', '+');
    expect(entries).toHaveLength(1);
    const event = JSON.parse(entries[0]![1][1]!);
    expect(event).toMatchObject({ type: 'whatsapp.order_code_received', version: 1, tenant: 'teste', source: 'whatsapp', data: { code: 'OS-K7Q2-X9MA', from: phone, wamid: 'wamid.A' } });
    expect((await outboxRows()).rows[0]!.published_at).not.toBeNull();
    expect(await relay.publishBatch()).toBe(0);
    expect(await redis.xlen(stream)).toBe(1);
  });

  it('rate limit por remetente: passou do limite, a mensagem deixa de virar evento', async () => {
    for (let i = 0; i < 6; i++) await webhooks.handle(payload(`wamid.R${i}`, `OS-K7Q2-X9M${i}`));
    expect((await outboxRows()).rows).toHaveLength(3); // limite de teste = 3 (o primeiro evento já conta)
    const { rows } = await db.query('SELECT 1 FROM inbound_messages WHERE from_phone = $1 AND wamid LIKE $2', [phone, 'wamid.R%']);
    expect(rows).toHaveLength(6); // as mensagens continuam registradas
  });
});
