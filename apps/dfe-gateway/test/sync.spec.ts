import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseDistResponse } from '../src/core/parser/dist-response.parser.js';
import { SefazTransportError } from '../src/core/sefaz/dfe-source.js';
import { Database } from '../src/db/database.service.js';
import { RelayService } from '../src/delivery/relay.service.js';
import { verifyWebhook } from '../src/delivery/signature.js';
import { SyncRunner } from '../src/sync/sync.runner.js';
import { SyncScheduler } from '../src/sync/sync.scheduler.js';
import { boot, CNPJ, ScriptedSource } from './harness.js';
import { makePfx } from './make-pfx.js';
import { makeAccessKey, makeDistResponse, makeProcNfe, makeResNfe } from './nfe-xml.js';

// Relógio real (+5 s): colunas com DEFAULT now() do banco precisam estar vencidas para o "agora" da rodada.
const NOW = new Date(Date.now() + 5_000);
const HOUR = 3_600_000;
const dist = (o: Parameters<typeof makeDistResponse>[0]) => parseDistResponse(makeDistResponse(o));

let h: Awaited<ReturnType<typeof boot>>;
let source: ScriptedSource;
let key: string;
let db: Database;
let runner: SyncRunner;
let companyId: string;

async function reset(over: { enabled?: boolean; autoManifest?: boolean } = {}) {
  await db.query('DELETE FROM documents');
  await db.query('DELETE FROM deliveries');
  await db.query('DELETE FROM manifestations');
  await db.query(`UPDATE sync_state SET last_nsu = 0, max_nsu = 0, next_poll_at = now() - interval '1 second', consecutive_failures = 0, last_status_code = NULL, last_error = NULL, lease_until = NULL, lease_owner = NULL WHERE company_id = $1`, [companyId]);
  await db.query(`UPDATE credentials SET enabled = $1, auto_manifest = $2, status = 'ACTIVE' WHERE company_id = $3`, [over.enabled ?? true, over.autoManifest ?? false, companyId]);
  source.calls = [];
  source.manifests = [];
}
const state = async () => (await db.query(`SELECT last_nsu::text, max_nsu::text, next_poll_at, consecutive_failures, last_status_code, last_error FROM sync_state WHERE company_id = $1`, [companyId])).rows[0]!;
const docs = async () => (await db.query<{ nsu: string; schema: string }>(`SELECT nsu::text, schema FROM documents WHERE company_id = $1 ORDER BY nsu`, [companyId])).rows;

beforeAll(async () => {
  source = new ScriptedSource();
  h = await boot(source);
  key = (await h.makeTenant('fixer-a')).key;
  db = h.app.get(Database);
  runner = h.app.get(SyncRunner);
  await h.call(key, 'PUT', `/v1/companies/${CNPJ}`, {});
  const { pfx, password } = makePfx({ cnpj: CNPJ });
  expect((await h.call(key, 'PUT', `/v1/companies/${CNPJ}/credential`, { pfxBase64: pfx.toString('base64'), password, environment: 'HOMOLOGATION' })).status).toBe(200);
  companyId = (await db.query<{ id: string }>('SELECT id FROM companies WHERE cnpj = $1', [CNPJ])).rows[0]!.id;
});
afterAll(async () => h.app.close());
beforeEach(() => reset());

describe('rodada de sincronização', () => {
  it('grava o lote, avança o NSU e devolve os documentos por cursor (XML intacto)', async () => {
    const a = makeProcNfe({ number: 1 });
    const b = makeProcNfe({ number: 2 });
    source.script = [
      dist({ cStat: 138, ultNSU: '2', maxNSU: '2', docs: [{ nsu: '1', schema: 'procNFe_v4.00.xsd', xml: a.xml }, { nsu: '2', schema: 'procNFe_v4.00.xsd', xml: b.xml }] }),
    ];
    const r = await runner.runOnce(companyId, NOW, () => 0);
    expect(r.outcome).toBe('IDLE'); // ultNSU = maxNSU: fila esgotada
    expect(r.counters).toMatchObject({ stored: 2, duplicate: 0, invalid: 0 });
    expect(source.calls[0]).toMatchObject({ cnpj: CNPJ, ultNsu: 0n });
    expect(await state()).toMatchObject({ last_nsu: '2', max_nsu: '2', consecutive_failures: 0, last_status_code: 138 });

    const page = await h.call(key, 'GET', `/v1/companies/${CNPJ}/documents?afterNsu=0&limit=1`);
    expect(page.body).toMatchObject({ lastNsu: '2', nextCursor: '1' });
    expect(page.body!.items[0]).toMatchObject({ nsu: '1', schema: 'procNFe_v4.00.xsd', accessKey: a.key, xml: a.xml });
    const rest = await h.call(key, 'GET', `/v1/companies/${CNPJ}/documents?afterNsu=1`);
    expect(rest.body!.items.map((d: { nsu: string }) => d.nsu)).toEqual(['2']);
    expect(rest.body!.nextCursor).toBeNull();
    expect((await h.call(key, 'GET', `/v1/companies/${CNPJ}/documents/${b.key}`)).body).toMatchObject({ nsu: '2', xml: b.xml });
  });

  it('138 com mais documentos pedidos a seguir devolve MORE sem esperar', async () => {
    source.script = [dist({ cStat: 138, ultNSU: '1', maxNSU: '5', docs: [{ nsu: '1', schema: 'procNFe_v4.00.xsd', xml: makeProcNfe({ number: 3 }).xml }] })];
    const r = await runner.runOnce(companyId, NOW, () => 0);
    expect(r.outcome).toBe('MORE');
    expect((await state()).next_poll_at.getTime()).toBeLessThan(NOW.getTime() + 5_000);
  });

  it('reprocessar o mesmo lote (NSU regrediu) não duplica documento', async () => {
    const x = makeProcNfe({ number: 4 });
    const batch = () => dist({ cStat: 138, ultNSU: '1', maxNSU: '1', docs: [{ nsu: '1', schema: 'procNFe_v4.00.xsd', xml: x.xml }] });
    source.script = [batch(), batch()];
    await runner.runOnce(companyId, NOW, () => 0);
    await db.query('UPDATE sync_state SET last_nsu = 0, next_poll_at = $2 WHERE company_id = $1', [companyId, new Date(NOW.getTime() - 1)]);
    const again = await runner.runOnce(companyId, NOW, () => 0);
    expect(again.counters).toMatchObject({ stored: 0, duplicate: 1 });
    expect(await docs()).toHaveLength(1);
  });

  it('documento inválido não derruba o lote nem trava o NSU', async () => {
    const ok = makeProcNfe({ number: 5 });
    const res = dist({ cStat: 138, ultNSU: '2', maxNSU: '2', docs: [{ nsu: '1', schema: 'procNFe_v4.00.xsd', xml: ok.xml }] });
    res.documents.push({ nsu: 2n, schema: 'procNFe_v4.00.xsd', xml: '', error: 'docZip inválido' });
    source.script = [res];
    const r = await runner.runOnce(companyId, NOW, () => 0);
    expect(r.counters).toMatchObject({ stored: 1, invalid: 1 });
    expect((await state()).last_nsu).toBe('2');
  });

  it('137: espera ~1 h e não perde o ultNSU', async () => {
    source.script = [dist({ cStat: 137, ultNSU: '221', maxNSU: '221' })];
    const r = await runner.runOnce(companyId, NOW, () => 0);
    expect(r.outcome).toBe('IDLE');
    const s = await state();
    expect(s.last_nsu).toBe('221');
    expect(s.next_poll_at.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(HOUR);
  });

  it('656: bloqueia por mais de 1 h e NÃO adota o NSU da rejeição (pularia documentos)', async () => {
    source.script = [dist({ cStat: 656, xMotivo: 'Consumo Indevido', ultNSU: '221' })];
    const r = await runner.runOnce(companyId, NOW, () => 0);
    expect(r.outcome).toBe('BLOCKED');
    const s = await state();
    expect(s.last_nsu).toBe('0');
    expect(s.last_status_code).toBe(656);
    expect(s.next_poll_at.getTime() - NOW.getTime()).toBeGreaterThan(HOUR);
    expect(s.last_error).toContain('221');
  });

  it('656 três vezes seguidas desliga a sincronização', async () => {
    for (let i = 0; i < 3; i++) {
      source.script = [dist({ cStat: 656, xMotivo: 'Consumo Indevido', ultNSU: '9' })];
      await runner.runOnce(companyId, NOW, () => 0);
    }
    const cred = (await db.query('SELECT enabled, status FROM credentials WHERE company_id = $1', [companyId])).rows[0]!;
    expect(cred).toMatchObject({ enabled: false, status: 'DISABLED' });
    expect((await state()).last_error).toMatch(/desligada/);
  });

  it('falha de rede: backoff, NSU intacto, nada gravado', async () => {
    source.script = [new SefazTransportError('timeout')];
    const r = await runner.runOnce(companyId, NOW, () => 0);
    expect(r.outcome).toBe('RETRY');
    expect(await docs()).toHaveLength(0);
    expect(await state()).toMatchObject({ last_nsu: '0', consecutive_failures: 1 });
  });

  it('certificado vencido desliga o CNPJ sem consultar a SEFAZ', async () => {
    await db.query(`UPDATE credentials SET not_after = $2 WHERE company_id = $1`, [companyId, new Date(NOW.getTime() - 1000)]);
    // O material é decifrado do .pfx real (ainda válido); o vencimento vem do próprio certificado, então simulamos pelo relógio.
    source.script = [];
    const r = await runner.runOnce(companyId, new Date(NOW.getTime() + 400 * 86_400_000), () => 0);
    expect(r.outcome).toBe('DISABLE');
    expect(source.calls).toHaveLength(0);
    expect((await db.query('SELECT status, enabled FROM credentials WHERE company_id = $1', [companyId])).rows[0]).toMatchObject({ status: 'EXPIRED', enabled: false });
  });

  it('desligado = nenhuma consulta', async () => {
    await reset({ enabled: false });
    expect((await runner.runOnce(companyId, NOW)).outcome).toBe('IDLE');
    expect(source.calls).toHaveLength(0);
  });
});

describe('ciência da operação', () => {
  const issuerKey = makeAccessKey('99887766000155', 77);

  it('enfileira resumos autorizados de terceiros e registra a ciência', async () => {
    await reset({ autoManifest: true });
    const own = makeAccessKey(CNPJ, 78); // emitida por nós: não pede ciência
    const canceled = makeAccessKey('99887766000155', 79);
    source.script = [
      dist({
        cStat: 138,
        ultNSU: '3',
        maxNSU: '3',
        docs: [
          { nsu: '1', schema: 'resNFe_v1.01.xsd', xml: makeResNfe(issuerKey) },
          { nsu: '2', schema: 'resNFe_v1.01.xsd', xml: makeResNfe(own, { issuer: CNPJ }) },
          { nsu: '3', schema: 'resNFe_v1.01.xsd', xml: makeResNfe(canceled, { situation: 3 }) },
        ],
      }),
    ];
    source.manifestReply = { batchStatus: 128, batchMotivo: 'ok', events: [{ accessKey: issuerKey, cStat: 135, xMotivo: 'ok', protocol: '1' }] };
    const r = await runner.runOnce(companyId, NOW, () => 0);
    expect(r.counters).toMatchObject({ stored: 3, manifestQueued: 1 });
    expect(source.manifests).toHaveLength(1);
    expect(source.manifests[0]).toMatchObject({ cnpj: CNPJ, accessKeys: [issuerKey] });
    expect((await db.query('SELECT access_key, status FROM manifestations')).rows).toEqual([{ access_key: issuerKey, status: 'REGISTERED' }]);
  });

  it('rejeição da SEFAZ conta tentativa com backoff; falha de rede não penaliza a chave', async () => {
    await reset({ autoManifest: true });
    source.script = [dist({ cStat: 138, ultNSU: '1', maxNSU: '1', docs: [{ nsu: '1', schema: 'resNFe_v1.01.xsd', xml: makeResNfe(issuerKey) }] })];
    source.manifestReply = { batchStatus: 128, batchMotivo: 'ok', events: [{ accessKey: issuerKey, cStat: 999, xMotivo: 'negado', protocol: null }] };
    await runner.runOnce(companyId, NOW, () => 0);
    expect((await db.query('SELECT status, attempts, error FROM manifestations')).rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, error: '999 negado' });

    await db.query(`UPDATE manifestations SET next_at = now() - interval '1 minute'`);
    source.script = [dist({ cStat: 137, ultNSU: '1', maxNSU: '1' })];
    await db.query('UPDATE sync_state SET next_poll_at = $2 WHERE company_id = $1', [companyId, new Date(NOW.getTime() - 1)]);
    source.manifestReply = new SefazTransportError('fora do ar');
    await runner.runOnce(companyId, NOW, () => 0);
    expect((await db.query('SELECT attempts FROM manifestations')).rows[0]!.attempts).toBe(1);
  });

  it('ciência manual por API fica na fila e é processada na próxima rodada', async () => {
    await reset({ autoManifest: false });
    const q = await h.call(key, 'POST', `/v1/companies/${CNPJ}/manifestations`, { accessKeys: [issuerKey] });
    expect(q).toMatchObject({ status: 202, body: { queued: 1 } });
    expect((await h.call(key, 'POST', `/v1/companies/${CNPJ}/manifestations`, { accessKeys: [issuerKey] })).body).toEqual({ queued: 0 });
    source.manifestReply = { batchStatus: 128, batchMotivo: 'ok', events: [{ accessKey: issuerKey, cStat: 135, xMotivo: 'ok', protocol: '1' }] };
    source.script = [dist({ cStat: 137, ultNSU: '0', maxNSU: '0' })];
    await runner.runOnce(companyId, NOW, () => 0);
    expect((await h.call(key, 'GET', `/v1/companies/${CNPJ}/manifestations?status=REGISTERED`)).body!.items).toHaveLength(1);
  });
});

describe('lease por CNPJ', () => {
  it('dois workers disputando: só um conquista o CNPJ', async () => {
    const sched = h.app.get(SyncScheduler) as unknown as { acquire(n: number): Promise<string[]> };
    const other = Object.create(sched) as typeof sched;
    (other as unknown as { config: object }).config = { ...(sched as unknown as { config: object }).config, owner: 'outro-worker' };
    const [x, y] = await Promise.all([sched.acquire(5), other.acquire(5)]);
    expect([...x, ...y]).toEqual([companyId]);
    // Já com lease: ninguém mais pega até expirar.
    expect(await sched.acquire(5)).toEqual([]);
  });

  it('CNPJ desligado ou ainda dentro do intervalo não é conquistado', async () => {
    const sched = h.app.get(SyncScheduler) as unknown as { acquire(n: number): Promise<string[]> };
    await db.query(`UPDATE sync_state SET next_poll_at = now() + interval '1 hour' WHERE company_id = $1`, [companyId]);
    expect(await sched.acquire(5)).toEqual([]);
    await db.query(`UPDATE sync_state SET next_poll_at = now() - interval '1 second' WHERE company_id = $1`, [companyId]);
    await db.query(`UPDATE credentials SET enabled = false WHERE company_id = $1`, [companyId]);
    expect(await sched.acquire(5)).toEqual([]);
  });
});

describe('entrega aos consumidores', () => {
  // `next_attempt_at` nasce com o relógio real do banco; o relay recebe o "agora" por parâmetro.
  const T0 = () => new Date(Date.now() + 5_000);
  let receiver: Server;
  let url: string;
  let replies: number[];
  let seen: { body: string; sig: string; id: string }[];
  let secret: string;

  beforeAll(async () => {
    replies = [];
    seen = [];
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ body, sig: String(req.headers['x-dfe-signature']), id: String(req.headers['x-dfe-message-id']) });
        res.statusCode = replies.shift() ?? 200;
        res.end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  });
  afterAll(async () => void receiver.close());

  beforeEach(async () => {
    seen = [];
    replies = [];
    const put = await h.call(key, 'PUT', `/v1/companies/${CNPJ}/subscription`, { transport: 'WEBHOOK', target: { url } });
    expect(put.status).toBe(200);
    secret = put.body!.secret;
  });

  const ingest = async (nsu: string, n: number) => {
    source.script = [dist({ cStat: 138, ultNSU: nsu, maxNSU: '99', docs: [{ nsu, schema: 'procNFe_v4.00.xsd', xml: makeProcNfe({ number: n }).xml }] })];
    await db.query('UPDATE sync_state SET next_poll_at = $2 WHERE company_id = $1', [companyId, new Date(NOW.getTime() - 1)]);
    await runner.runOnce(companyId, NOW, () => 0);
  };

  it('junta vários lotes em UM aviso, assinado e sem XML', async () => {
    await ingest('1', 11);
    await ingest('2', 12);
    await ingest('3', 13);
    expect((await db.query(`SELECT from_nsu::text, to_nsu::text FROM deliveries WHERE state = 'PENDING'`)).rows).toEqual([{ from_nsu: '1', to_nsu: '3' }]);

    const relay = h.app.get(RelayService);
    expect(await relay.drain(T0())).toBe(1);
    expect(seen).toHaveLength(1);
    const msg = JSON.parse(seen[0]!.body);
    expect(msg).toMatchObject({ v: 1, companyCnpj: CNPJ, fromNsu: '1', toNsu: '3' });
    expect(seen[0]!.body).not.toContain('<');
    expect(seen[0]!.id).toBe(msg.messageId);
    expect(verifyWebhook(secret, seen[0]!.body, seen[0]!.sig)).toBe(true);
    expect(verifyWebhook('outro-segredo', seen[0]!.body, seen[0]!.sig)).toBe(false);
    expect((await db.query(`SELECT state FROM deliveries`)).rows).toEqual([{ state: 'DELIVERED' }]);
  });

  it('PULL não gera entrega', async () => {
    await h.call(key, 'PUT', `/v1/companies/${CNPJ}/subscription`, { transport: 'PULL' });
    await ingest('1', 14);
    expect((await db.query('SELECT 1 FROM deliveries')).rowCount).toBe(0);
  });

  it('consumidor fora do ar (500): reagenda com backoff, sem perder o aviso nem queimar a assinatura', async () => {
    await ingest('1', 15);
    replies = [500];
    const relay = h.app.get(RelayService);
    const t0 = T0();
    await relay.drain(t0);
    const d = (await db.query(`SELECT state, attempts, last_error, next_attempt_at FROM deliveries`)).rows[0]!;
    expect(d).toMatchObject({ state: 'PENDING', attempts: 1, last_error: 'Webhook respondeu HTTP 500' });
    expect(d.next_attempt_at.getTime()).toBeGreaterThan(t0.getTime());
    expect(await relay.drain(t0)).toBe(0); // ainda dentro do backoff
    await relay.drain(new Date(t0.getTime() + 2 * 60_000));
    expect((await db.query(`SELECT state FROM deliveries`)).rows[0]!.state).toBe('DELIVERED');
  });

  it('erro permanente do consumidor (404) mata a entrega e marca a assinatura FAILING; PUT reativa', async () => {
    await ingest('1', 16);
    replies = [404];
    await h.app.get(RelayService).drain(T0());
    expect((await db.query(`SELECT state FROM deliveries`)).rows[0]!.state).toBe('DEAD');
    expect((await db.query(`SELECT status FROM subscriptions WHERE transport = 'WEBHOOK'`)).rows[0]!.status).toBe('FAILING');
    // FAILING não acumula avisos novos; o consumidor se recupera pelo cursor.
    await ingest('2', 17);
    expect((await db.query(`SELECT 1 FROM deliveries WHERE state = 'PENDING'`)).rowCount).toBe(0);
    await h.call(key, 'PUT', `/v1/companies/${CNPJ}/subscription`, { transport: 'WEBHOOK', target: { url } });
    expect((await db.query(`SELECT status FROM subscriptions WHERE transport = 'WEBHOOK'`)).rows[0]!.status).toBe('ACTIVE');
  });

  it('o cursor recupera tudo mesmo sem nenhum aviso', async () => {
    await ingest('1', 18);
    await ingest('2', 19);
    const r = await h.call(key, 'GET', `/v1/companies/${CNPJ}/documents?afterNsu=0`);
    expect(r.body!.items).toHaveLength(2);
  });

  it('ack avança o cursor, nunca retrocede nem passa do que o gateway tem', async () => {
    await ingest('1', 20);
    await ingest('2', 21);
    expect((await h.call(key, 'POST', `/v1/companies/${CNPJ}/subscription/ack`, { nsu: '2' })).body).toEqual({ ackedNsu: '2' });
    expect((await h.call(key, 'POST', `/v1/companies/${CNPJ}/subscription/ack`, { nsu: '1' })).body).toEqual({ ackedNsu: '2' });
    expect((await h.call(key, 'POST', `/v1/companies/${CNPJ}/subscription/ack`, { nsu: '50' })).status).toBe(400);
  });
});
