import { PrismaClient } from '@fixer/db';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeDistResponse, makeEvent, makeProcNfe, makeResNfe } from '../../test/fiscal/nfe-xml.js';
import { testConfig } from '../../test/fiscal/config.js';
import { parseDistResponse } from './parser/dist-response.parser.js';
import type { EnvEventoResponse } from './parser/event-response.parser.js';
import { ManifestService, MAX_MANIFEST_ATTEMPTS } from './sync/manifest.service.js';
import { SyncRunner } from './sync/sync.runner.js';
import { SyncScheduler } from './sync/sync.scheduler.js';

/**
 * Integração com Postgres REAL: lease atômico entre réplicas, lote + NSU na mesma transação, e as
 * constraints que sustentam a idempotência. Só roda com FISCAL_TEST_DATABASE_URL (banco de dev já
 * migrado). Recusa rodar se já houver credencial fiscal no banco, para nunca mexer em dado real, e
 * remove tudo o que cria.
 *
 *   FISCAL_TEST_DATABASE_URL=postgresql://fixer_app:password@localhost:5432/fixer npm test -w @fixer/api
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const USER = 'itest-fiscal-user';
const TENANT = '12ABC34501DE35';

describe.skipIf(!URL)('Sincronização fiscal (Postgres, integração)', () => {
  let db: PrismaClient;
  let other: PrismaClient; // segunda conexão = segunda réplica
  const keys = new Set<string>();

  const cleanup = async () => {
    await db.stockMovement.deleteMany({ where: { createdById: USER } });
    await db.purchaseInvoiceItem.deleteMany({ where: { invoice: { accessKey: { in: [...keys] } } } });
    await db.purchaseInvoice.deleteMany({ where: { accessKey: { in: [...keys] } } });
    await db.part.deleteMany({ where: { sku: { startsWith: 'ITEST-' } } });
    await db.fiscalSyncState.deleteMany();
    await db.fiscalCredential.deleteMany();
    await db.tenantFiscalSettings.deleteMany({ where: { cnpj: TENANT } });
    await db.user.deleteMany({ where: { id: USER } });
  };

  let release: () => Promise<void>;

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    db = new PrismaClient({ datasourceUrl: URL });
    other = new PrismaClient({ datasourceUrl: URL });
    if ((await db.fiscalCredential.count()) > 0) throw new Error('Há credencial fiscal no banco: recusando rodar o teste de integração');
    await cleanup();
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
    await other.$disconnect();
    await release();
  }, 60_000);

  beforeEach(async () => {
    await cleanup();
    keys.clear();
    await db.user.create({ data: { id: USER, keycloakId: USER, name: 'Teste', email: 'itest-fiscal@x.test' } });
    await db.tenantFiscalSettings.upsert({ where: { id: 1 }, create: { id: 1, cnpj: TENANT, ufCode: 35 }, update: { cnpj: TENANT, ufCode: 35 } });
    await db.fiscalCredential.create({
      data: {
        id: 1,
        enabled: true,
        pfxCiphertext: Buffer.from('x'),
        pfxPassCiphertext: Buffer.from('y'),
        keyId: 'k1',
        subject: 's',
        certCnpj: '11222333000181',
        notBefore: new Date(0),
        notAfter: new Date(Date.now() + 365 * 86_400_000),
        uploadedById: USER,
      },
    });
    await db.fiscalSyncState.create({ data: { id: 1, nextPollAt: new Date(0) } });
  });

  const nfe = (number: number) => {
    const n = makeProcNfe({ number });
    keys.add(n.key);
    return n;
  };
  const material = {
    keyPem: 'k',
    certPem: 'c',
    chainPem: [],
    subject: 's',
    certCnpj: '11222333000181',
    notBefore: new Date(0),
    notAfter: new Date(Date.now() + 365 * 86_400_000),
    environment: 'HOMOLOGATION' as const,
  };
  const runnerFor = (prisma: PrismaClient, responses: string[]) =>
    new SyncRunner(
      prisma as never,
      { openMaterial: async () => material } as never,
      { distribute: async () => parseDistResponse(responses.shift()!), manifest: async () => ({ batchStatus: 128, batchMotivo: '', events: [] }) },
      { runPending: async () => ({ manifested: 0, rejected: 0, ignored: 0, aborted: null }) } as never,
    );

  it('lote + NSU gravam juntos no banco real; reprocessar não duplica', async () => {
    const a = nfe(1);
    const b = nfe(2);
    const batch = () =>
      makeDistResponse({
        cStat: 138,
        ultNSU: '2',
        maxNSU: '2',
        docs: [
          { nsu: '1', schema: 'procNFe_v4.00.xsd', xml: a.xml },
          { nsu: '2', schema: 'procNFe_v4.00.xsd', xml: b.xml },
        ],
      });
    const runner = runnerFor(db, [batch(), batch()]);
    await runner.runOnce();
    await db.fiscalSyncState.update({ where: { id: 1 }, data: { lastNsu: 0n } }); // reentrega do mesmo lote
    await runner.runOnce();

    expect(await db.purchaseInvoice.count({ where: { accessKey: { in: [a.key, b.key] } } })).toBe(2);
    const inv = await db.purchaseInvoice.findUniqueOrThrow({ where: { accessKey: a.key }, include: { items: { orderBy: { itemNumber: 'asc' } } } });
    expect(inv).toMatchObject({ status: 'FULL', exportStatus: 'PENDING_MATCH', recipientCnpj: TENANT, issuerCnpj: '11222333000181' });
    expect(inv.items).toHaveLength(2);
    expect(inv.items[0]!.quantity.toString()).toBe('2');
    expect(inv.items[0]!.resolution).toBe('UNRESOLVED'); // default do banco
    expect(inv.xmlGz).toBeInstanceOf(Buffer);
    expect(await db.fiscalSyncState.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ lastNsu: 2n, consecutiveFailures: 0 });
  });

  it('falha no meio do lote: a 1ª nota é desfeita no banco real e o NSU não anda', async () => {
    const first = nfe(3);
    const second = nfe(4);
    const response = makeDistResponse({
      cStat: 138,
      ultNSU: '2',
      maxNSU: '2',
      docs: [
        { nsu: '1', schema: 'procNFe_v4.00.xsd', xml: first.xml },
        { nsu: '2', schema: 'procNFe_v4.00.xsd', xml: second.xml },
      ],
    });
    // Cliente real, mas a 2ª inserção de nota falha DENTRO da transação (conexão caindo, por exemplo).
    let inserts = 0;
    const flaky = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== '$transaction') return Reflect.get(target, prop, receiver);
        return (fn: (tx: unknown) => Promise<unknown>, opts: unknown) =>
          target.$transaction(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p, r) {
                    if (p !== 'purchaseInvoice') return Reflect.get(t, p, r);
                    return new Proxy(t.purchaseInvoice, {
                      get(m, name, mr) {
                        if (name === 'create') {
                          return (args: never) => (++inserts === 2 ? Promise.reject(new Error('conexão perdida')) : m.create(args));
                        }
                        return Reflect.get(m, name, mr);
                      },
                    });
                  },
                }),
              ),
            opts as never,
          );
      },
    });

    const r = await runnerFor(flaky, [response]).runOnce();

    expect(inserts).toBe(2);
    expect(r.outcome).toBe('RETRY');
    expect(await db.purchaseInvoice.count({ where: { accessKey: { in: [first.key, second.key] } } })).toBe(0);
    expect(await db.purchaseInvoiceItem.count({ where: { invoice: { accessKey: first.key } } })).toBe(0);
    expect(await db.fiscalSyncState.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ lastNsu: 0n, consecutiveFailures: 1 });

    // Sem a falha, a rodada seguinte grava tudo e o NSU avança.
    const ok = await runnerFor(db, [response]).runOnce();
    expect(ok.outcome).toBe('IDLE');
    expect(await db.purchaseInvoice.count({ where: { accessKey: { in: [first.key, second.key] } } })).toBe(2);
    expect(await db.fiscalSyncState.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ lastNsu: 2n, consecutiveFailures: 0 });
  });

  it('cancelamento antes da nota: a nota que chega depois continua cancelada', async () => {
    const n = nfe(5);
    const runner = runnerFor(db, [
      makeDistResponse({ cStat: 138, ultNSU: '1', maxNSU: '2', docs: [{ nsu: '1', ...makeEvent(n.key, { full: false }) }] }),
      makeDistResponse({ cStat: 138, ultNSU: '2', maxNSU: '2', docs: [{ nsu: '2', schema: 'procNFe_v4.00.xsd', xml: n.xml }] }),
    ]);
    await runner.runOnce();
    await runner.runOnce();
    const inv = await db.purchaseInvoice.findUniqueOrThrow({ where: { accessKey: n.key }, include: { items: true } });
    expect(inv).toMatchObject({ status: 'CANCELED', exportStatus: 'VOIDED' });
    expect(inv.items).toHaveLength(0);
  });

  it('resumo seguido da nota completa mantém uma só linha', async () => {
    const n = nfe(6);
    const runner = runnerFor(db, [
      makeDistResponse({ cStat: 138, ultNSU: '1', maxNSU: '2', docs: [{ nsu: '1', schema: 'resNFe_v1.00.xsd', xml: makeResNfe(n.key) }] }),
      makeDistResponse({ cStat: 138, ultNSU: '2', maxNSU: '2', docs: [{ nsu: '2', schema: 'procNFe_v4.00.xsd', xml: n.xml }] }),
    ]);
    await runner.runOnce();
    expect((await db.purchaseInvoice.findUniqueOrThrow({ where: { accessKey: n.key } })).status).toBe('SUMMARY');
    await runner.runOnce();
    expect(await db.purchaseInvoice.count({ where: { accessKey: n.key } })).toBe(1);
    expect((await db.purchaseInvoice.findUniqueOrThrow({ where: { accessKey: n.key } })).status).toBe('FULL');
  });

  it('duas réplicas disputando o mesmo tick: só uma consulta a SEFAZ', async () => {
    let calls = 0;
    const slowRunner = (prisma: PrismaClient) =>
      new SyncRunner(
        prisma as never,
        { openMaterial: async () => material } as never,
        {
          distribute: async () => {
            calls++;
            await new Promise((r) => setTimeout(r, 150)); // a chamada à SEFAZ é lenta: o lease precisa segurar
            return parseDistResponse(makeDistResponse({ cStat: 137, ultNSU: '0', maxNSU: '0' }));
          },
          manifest: async () => ({ batchStatus: 128, batchMotivo: '', events: [] }),
        },
        { runPending: async () => ({ manifested: 0, rejected: 0, ignored: 0, aborted: null }) } as never,
      );
    const cfg = testConfig({ tickMs: 1000, requestTimeoutMs: 1000 });
    const k = { available: true } as never;
    const s1 = new SyncScheduler(db as never, slowRunner(db), k, cfg);
    const s2 = new SyncScheduler(other as never, slowRunner(other), k, cfg);
    await Promise.all([s1.tick(), s2.tick(), s1.tick(), s2.tick()]);
    expect(calls).toBe(1);
    // Terminou em 137: próxima consulta só em ≥ 1 h, então um novo tick não consulta.
    await s1.tick();
    expect(calls).toBe(1);
    const state = await db.fiscalSyncState.findUniqueOrThrow({ where: { id: 1 } });
    expect(state.leaseUntil).toBeNull();
    expect(state.nextPollAt.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
  });

  it('credencial desligada ou nextPollAt no futuro: ninguém conquista o lease', async () => {
    let calls = 0;
    const runner = { runOnce: async () => (calls++, { outcome: 'IDLE', cStat: 137 }) };
    const cfg = testConfig({ tickMs: 1000, requestTimeoutMs: 1000 });
    const s = new SyncScheduler(db as never, runner as never, { available: true } as never, cfg);

    await db.fiscalCredential.update({ where: { id: 1 }, data: { enabled: false } });
    await s.tick();
    await db.fiscalCredential.update({ where: { id: 1 }, data: { enabled: true } });
    await db.fiscalSyncState.update({ where: { id: 1 }, data: { nextPollAt: new Date(Date.now() + 3_600_000) } });
    await s.tick();
    expect(calls).toBe(0);

    await db.fiscalSyncState.update({ where: { id: 1 }, data: { nextPollAt: new Date(0) } });
    await s.tick();
    expect(calls).toBe(1);
  });

  it('lease vencido de uma réplica morta é assumido por outra', async () => {
    let calls = 0;
    const runner = { runOnce: async () => (calls++, { outcome: 'IDLE', cStat: 137 }) };
    const cfg = testConfig({ tickMs: 1000, requestTimeoutMs: 1000 });
    const s = new SyncScheduler(db as never, runner as never, { available: true } as never, cfg);

    await db.fiscalSyncState.update({ where: { id: 1 }, data: { leaseOwner: 'morta', leaseUntil: new Date(Date.now() + 60_000) } });
    await s.tick();
    expect(calls).toBe(0); // lease ainda válido

    await db.fiscalSyncState.update({ where: { id: 1 }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
    await s.tick();
    expect(calls).toBe(1);
  });

  it('NSU de 15 dígitos cabe e volta como BigInt', async () => {
    await db.fiscalSyncState.update({ where: { id: 1 }, data: { lastNsu: 999999999999999n } });
    expect((await db.fiscalSyncState.findUniqueOrThrow({ where: { id: 1 } })).lastNsu).toBe(999999999999999n);
  });

  describe('ciência da operação (Postgres real)', () => {
    const noop = { distribute: async () => parseDistResponse(makeDistResponse({ cStat: 137 })) };
    const serviceWith = (reply: (keys: string[]) => EnvEventoResponse | Promise<EnvEventoResponse>) =>
      new ManifestService(
        db as never,
        { openMaterial: async () => material } as never,
        { ...noop, manifest: async (_m: unknown, p: { accessKeys: string[] }) => reply(p.accessKeys) } as never,
      );
    const lote = (events: [string, number][]): EnvEventoResponse => ({
      batchStatus: 128,
      batchMotivo: 'ok',
      events: events.map(([accessKey, cStat]) => ({ accessKey, cStat, xMotivo: `m${cStat}`, protocol: null })),
    });
    const seedSummary = async (n: number) => {
      const key = nfe(n).key;
      await db.purchaseInvoice.create({
        data: { accessKey: key, issuerCnpj: '11222333000181', issuerName: 'F', totalAmount: '1', status: 'SUMMARY', receivedAt: new Date(1_000 * n) },
      });
      return key;
    };
    const NOW = new Date();

    it('escolhe só SUMMARY elegíveis e grava o resultado de cada uma', async () => {
      const [ok, ignored, rejected, waiting, exhausted] = [await seedSummary(10), await seedSummary(11), await seedSummary(12), await seedSummary(13), await seedSummary(14)];
      await db.purchaseInvoice.update({ where: { accessKey: waiting }, data: { manifestNextAt: new Date(NOW.getTime() + 3_600_000) } });
      await db.purchaseInvoice.update({ where: { accessKey: exhausted }, data: { manifestAttempts: MAX_MANIFEST_ATTEMPTS } });

      const seen: string[][] = [];
      const service = serviceWith((keys) => (seen.push(keys), lote([[ok, 135], [ignored, 650], [rejected, 572]])));
      const s = await service.runPending(material, TENANT, NOW);

      expect(seen[0]!.sort()).toEqual([ok, ignored, rejected].sort()); // fora: em espera e esgotada
      expect(s).toMatchObject({ manifested: 1, ignored: 1, rejected: 1 });
      const row = (k: string) => db.purchaseInvoice.findUniqueOrThrow({ where: { accessKey: k } });
      expect(await row(ok)).toMatchObject({ status: 'MANIFESTED', manifestError: null, manifestNextAt: null });
      expect((await row(ok)).manifestedAt).toBeInstanceOf(Date);
      expect(await row(ignored)).toMatchObject({ status: 'IGNORED', ignoredReason: 'CANCELED_OR_DENIED' });
      expect(await row(rejected)).toMatchObject({ status: 'SUMMARY', manifestAttempts: 1, manifestError: '572 m572' });
      expect((await row(rejected)).manifestNextAt!.getTime()).toBe(NOW.getTime() + 3_600_000);
      expect(await row(waiting)).toMatchObject({ status: 'SUMMARY', manifestAttempts: 0 });
      expect(await row(exhausted)).toMatchObject({ status: 'SUMMARY', manifestAttempts: MAX_MANIFEST_ATTEMPTS });
    });

    it('nota que virou FULL durante a ciência não é rebaixada (UPDATE condicionado ao status)', async () => {
      const key = await seedSummary(20);
      const service = serviceWith(async (keys) => {
        // o procNFe completo chega por outra conexão (e confirma) enquanto a ciência está em voo
        await other.purchaseInvoice.update({ where: { accessKey: key }, data: { status: 'FULL' } });
        return lote(keys.map((k) => [k, 135] as [string, number]));
      });
      await service.runPending(material, TENANT, NOW);
      expect((await db.purchaseInvoice.findUniqueOrThrow({ where: { accessKey: key } })).status).toBe('FULL');
    });

    it('de ponta a ponta: resumo → ciência (autoManifest) → XML completo na rodada seguinte', async () => {
      const n = nfe(30);
      await db.fiscalCredential.update({ where: { id: 1 }, data: { autoManifest: true } });
      const manifestSeen: string[] = [];
      const source = {
        distribute: async () => parseDistResponse(responses.shift()!),
        manifest: async (_m: unknown, p: { accessKeys: string[] }) => (manifestSeen.push(...p.accessKeys), lote(p.accessKeys.map((k) => [k, 135] as [string, number]))),
      };
      const responses = [
        makeDistResponse({ cStat: 138, ultNSU: '1', maxNSU: '1', docs: [{ nsu: '1', schema: 'resNFe_v1.00.xsd', xml: makeResNfe(n.key) }] }),
        makeDistResponse({ cStat: 138, ultNSU: '2', maxNSU: '2', docs: [{ nsu: '2', schema: 'procNFe_v4.00.xsd', xml: n.xml }] }),
      ];
      const manifest = new ManifestService(db as never, { openMaterial: async () => material } as never, source as never);
      const runner = new SyncRunner(db as never, { openMaterial: async () => material } as never, source as never, manifest);

      await runner.runOnce();
      expect(manifestSeen).toEqual([n.key]);
      expect((await db.purchaseInvoice.findUniqueOrThrow({ where: { accessKey: n.key } })).status).toBe('MANIFESTED');

      await runner.runOnce(); // uma hora depois, o XML completo chega pela distribuição
      const inv = await db.purchaseInvoice.findUniqueOrThrow({ where: { accessKey: n.key }, include: { items: true } });
      expect(inv).toMatchObject({ status: 'FULL', exportStatus: 'PENDING_MATCH' });
      expect(inv.items).toHaveLength(2);
      expect(manifestSeen).toEqual([n.key]); // não repete a ciência
    });
  });

  describe('idempotência do estoque (constraints)', () => {
    async function seed() {
      const n = nfe(7);
      await runnerFor(db, [
        makeDistResponse({ cStat: 138, ultNSU: '1', maxNSU: '1', docs: [{ nsu: '1', schema: 'procNFe_v4.00.xsd', xml: n.xml }] }),
      ]).runOnce();
      const item = await db.purchaseInvoiceItem.findFirstOrThrow({ where: { invoice: { accessKey: n.key } }, orderBy: { itemNumber: 'asc' } });
      const part = await db.part.create({ data: { sku: 'ITEST-1', name: 'Pastilha', costPrice: 1, sellPrice: 2 } });
      return { item, part };
    }
    const movement = (partId: string, itemId: string | null, type: 'PURCHASE' | 'ADJUSTMENT') => ({
      partId,
      type,
      quantity: 1,
      balanceAfter: 1,
      createdById: USER,
      purchaseInvoiceItemId: itemId,
    });

    it('um PURCHASE e um ADJUSTMENT por item de nota; o segundo PURCHASE é recusado', async () => {
      const { item, part } = await seed();
      await db.stockMovement.create({ data: movement(part.id, item.id, 'PURCHASE') });
      await expect(db.stockMovement.create({ data: movement(part.id, item.id, 'PURCHASE') })).rejects.toMatchObject({ code: 'P2002' });
      await expect(db.stockMovement.create({ data: movement(part.id, item.id, 'ADJUSTMENT') })).resolves.toBeTruthy();
      await expect(db.stockMovement.create({ data: movement(part.id, item.id, 'ADJUSTMENT') })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('movimentos comuns (sem nota) não são afetados: NULLs são distintos', async () => {
      const { part } = await seed();
      await db.stockMovement.create({ data: movement(part.id, null, 'PURCHASE') });
      await expect(db.stockMovement.create({ data: movement(part.id, null, 'PURCHASE') })).resolves.toBeTruthy();
    });

    it('item de nota e peça com movimento não podem ser apagados (Restrict)', async () => {
      const { item, part } = await seed();
      await db.stockMovement.create({ data: movement(part.id, item.id, 'PURCHASE') });
      await expect(db.purchaseInvoiceItem.delete({ where: { id: item.id } })).rejects.toBeTruthy();
      await expect(db.part.delete({ where: { id: part.id } })).rejects.toBeTruthy();
    });
  });
});
