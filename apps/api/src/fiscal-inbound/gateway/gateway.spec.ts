import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakePrisma, type Row } from '../../../test/fiscal/fake-prisma.js';
import { makeProcNfe, makeResNfe, makeAccessKey } from '../../../test/fiscal/nfe-xml.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CredentialService, KEY_PROVIDER } from '../credentials/credential.service.js';
import { FISCAL_CONFIG } from '../fiscal.config.js';
import { DFE_SOURCE } from '../sefaz/dfe-source.js';
import { ManifestService } from '../sync/manifest.service.js';
import { SyncRunner } from '../sync/sync.runner.js';
import { SyncScheduler } from '../sync/sync.scheduler.js';
import { GatewayClient, GatewayError, type GatewayDocument } from './gateway.client.js';
import { GATEWAY_CONFIG, loadGatewayConfig, type GatewayConfig } from './gateway.config.js';
import { GatewayConsumer, toDistDocument } from './gateway.consumer.js';

const CNPJ = '12ABC34501DE35';
const NOW = new Date('2026-10-11T15:00:00Z');
const cfg: GatewayConfig = { url: 'https://dfe.example', apiKey: 'dfe_x.y', pollMs: 1000, requestTimeoutMs: 1000 };

/** O fake do projeto não conhece `updateMany` de nota nem `findUniqueOrThrow` do estado; complementa só o que o consumidor usa. */
class Prisma extends FakePrisma {
  constructor() {
    super();
    Object.assign(this.fiscalSyncState, { findUniqueOrThrow: async () => ({ ...this.state! }) });
    Object.assign(this.purchaseInvoice, {
      updateMany: async ({ where, data }: { where: { accessKey: { in: string[] }; status: string }; data: Row }) => {
        const rows = [...this.invoices.values()].filter((r) => where.accessKey.in.includes(r.accessKey) && r.status === where.status);
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    });
  }
}

const doc = (nsu: number, schema: string, xml: string): GatewayDocument => ({ nsu: String(nsu), schema, accessKey: null, xml, receivedAt: NOW.toISOString() });

function fakeGateway(pages: { items: GatewayDocument[]; nextCursor: string | null }[], over: Partial<Record<keyof GatewayClient, unknown>> = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec = (fn: string, impl: (...a: any[]) => unknown) => async (...args: unknown[]) => {
    calls.push({ fn, args });
    return impl(...args);
  };
  const gw = {
    listDocuments: rec('listDocuments', () => ({ ...(pages.shift() ?? { items: [], nextCursor: null }), lastNsu: '99' })),
    ack: rec('ack', (_c: string, nsu: string) => ({ ackedNsu: nsu })),
    getCompany: rec('getCompany', () => ({
      cnpj: CNPJ,
      credential: { enabled: true, auto_manifest: true, not_after: '2027-07-06T00:00:00Z' },
      sync: { last_nsu: '99', max_nsu: '99', next_poll_at: '2026-10-11T16:00:00Z', last_status_code: 137, last_error: null, last_run_at: '2026-10-11T14:00:00Z', last_success_at: '2026-10-11T14:00:00Z', consecutive_failures: 0 },
    })),
    registeredManifestations: rec('registeredManifestations', () => ({ items: [] })),
    ...over,
  };
  return { gw: gw as unknown as GatewayClient, calls };
}

describe('toDistDocument', () => {
  it('converte o NSU para bigint e preserva schema e XML', () => {
    expect(toDistDocument(doc(7, 'procNFe_v4.00.xsd', '<x/>'))).toEqual({ nsu: 7n, schema: 'procNFe_v4.00.xsd', xml: '<x/>' });
  });
});

describe('GatewayConsumer', () => {
  const build = (db: Prisma, gw: GatewayClient) => new GatewayConsumer(db as never, gw, cfg);

  it('puxa o lote, grava as notas, avança o NSU e só depois confirma (ack)', async () => {
    const db = new Prisma();
    const proc = makeProcNfe({ number: 1 });
    const summaryKey = makeAccessKey('99887766000155', 2);
    const { gw, calls } = fakeGateway([
      { items: [doc(10, 'procNFe_v4.00.xsd', proc.xml), doc(11, 'resNFe_v1.01.xsd', makeResNfe(summaryKey))], nextCursor: null },
    ]);
    const r = await build(db, gw).tick(NOW);
    expect(r?.pulled).toBe(2);
    expect(db.state!.lastNsu).toBe(11n);
    expect(db.invoice(proc.key)).toMatchObject({ status: 'FULL' });
    expect(db.invoice(summaryKey)).toMatchObject({ status: 'SUMMARY' });
    expect(calls.find((c) => c.fn === 'ack')!.args).toEqual([CNPJ, '11']);
    expect(calls.find((c) => c.fn === 'listDocuments')!.args.slice(0, 2)).toEqual([CNPJ, '0']);
    expect(db.state).toMatchObject({ lastStatusCode: 137, consecutiveFailures: 0, maxNsu: 99n });
    expect(db.credential).toMatchObject({ enabled: true, autoManifest: true });
    expect(db.state!.leaseUntil).toBeNull(); // lease liberado
  });

  it('segue as páginas até o cursor acabar', async () => {
    const db = new Prisma();
    const a = makeProcNfe({ number: 1 });
    const b = makeProcNfe({ number: 2 });
    const { gw, calls } = fakeGateway([
      { items: [doc(1, 'procNFe_v4.00.xsd', a.xml)], nextCursor: '1' },
      { items: [doc(2, 'procNFe_v4.00.xsd', b.xml)], nextCursor: null },
    ]);
    await build(db, gw).tick(NOW);
    expect(db.state!.lastNsu).toBe(2n);
    expect(calls.filter((c) => c.fn === 'listDocuments').map((c) => c.args[1])).toEqual(['0', '1']);
  });

  it('falha ao gravar: o NSU não anda e NÃO há ack (a página volta no próximo ciclo)', async () => {
    const db = new Prisma();
    db.onInvoiceCreate = () => {
      throw new Error('banco caiu');
    };
    const { gw, calls } = fakeGateway([{ items: [doc(5, 'procNFe_v4.00.xsd', makeProcNfe({ number: 3 }).xml)], nextCursor: null }]);
    await expect(build(db, gw).tick(NOW)).rejects.toThrow('banco caiu');
    expect(db.state!.lastNsu).toBe(0n);
    expect(calls.some((c) => c.fn === 'ack')).toBe(false);
    expect(db.state!.leaseUntil).toBeNull(); // o lease é liberado mesmo na falha
  });

  it('gateway fora do ar: não lança, não mexe no NSU', async () => {
    const db = new Prisma();
    const { gw } = fakeGateway([], {
      listDocuments: async () => {
        throw new GatewayError('Não foi possível falar com o serviço de notas fiscais.', 503);
      },
    });
    await expect(build(db, gw).tick(NOW)).resolves.toMatchObject({ pulled: 0 });
    expect(db.state!.lastNsu).toBe(0n);
  });

  it('sem certificado ou sem CNPJ não consulta o gateway', async () => {
    const db = new Prisma();
    db.credential = null;
    const { gw, calls } = fakeGateway([]);
    expect(await build(db, gw).tick(NOW)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('outra réplica com o lease: não consome', async () => {
    const db = new Prisma();
    const { gw, calls } = fakeGateway([]);
    // O fake de updateMany do estado não avalia o OR do lease; simula a réplica ocupada devolvendo count 0.
    (db.fiscalSyncState as any).updateMany = async () => ({ count: 0 });
    expect(await build(db, gw).tick(NOW)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('ciência registrada no gateway promove SUMMARY a MANIFESTED (e só ela)', async () => {
    const db = new Prisma();
    const k1 = makeAccessKey('99887766000155', 5);
    const k2 = makeAccessKey('99887766000155', 6);
    const { gw } = fakeGateway(
      [{ items: [doc(1, 'resNFe_v1.01.xsd', makeResNfe(k1)), doc(2, 'resNFe_v1.01.xsd', makeResNfe(k2))], nextCursor: null }],
      { registeredManifestations: async () => ({ items: [{ accessKey: k1, registeredAt: NOW.toISOString() }] }) },
    );
    await build(db, gw).tick(NOW);
    expect(db.invoice(k1)).toMatchObject({ status: 'MANIFESTED' });
    expect(db.invoice(k2)).toMatchObject({ status: 'SUMMARY' });
  });
});

describe('loadGatewayConfig', () => {
  it('desligado quando nenhuma variável existe', () => expect(loadGatewayConfig({})).toBeNull());
  it('exige as duas variáveis juntas', () => {
    expect(() => loadGatewayConfig({ DFE_GATEWAY_URL: 'https://x' })).toThrow(/juntas/);
    expect(() => loadGatewayConfig({ DFE_GATEWAY_API_KEY: 'k' })).toThrow(/juntas/);
  });
  it('exige https (http só em localhost) e tira a barra final', () => {
    expect(() => loadGatewayConfig({ DFE_GATEWAY_URL: 'http://dfe.example', DFE_GATEWAY_API_KEY: 'k' })).toThrow(/https/);
    expect(loadGatewayConfig({ DFE_GATEWAY_URL: 'http://localhost:3010/', DFE_GATEWAY_API_KEY: 'k' })).toMatchObject({ url: 'http://localhost:3010', pollMs: 60_000 });
    expect(loadGatewayConfig({ DFE_GATEWAY_URL: 'https://dfe.example//', DFE_GATEWAY_API_KEY: 'k', DFE_GATEWAY_POLL_MS: '5000' })).toMatchObject({ url: 'https://dfe.example', pollMs: 5000 });
  });
});

describe('GatewayClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('envia a chave de API, o ator e não segue redirecionamento', async () => {
    const f = vi.fn(async () => new Response('{"ackedNsu":"3"}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await new GatewayClient(cfg).queueManifestations(CNPJ, ['K'], 'user-1');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`https://dfe.example/v1/companies/${CNPJ}/manifestations`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(init.headers).toMatchObject({ authorization: 'Bearer dfe_x.y', 'x-actor': 'user-1' });
  });

  it('mostra a mensagem do gateway em 4xx, mas esconde o corpo em 5xx', async () => {
    respond(400, { title: 'Certificado vencido' });
    await expect(new GatewayClient(cfg).inspect('a', 'b')).rejects.toMatchObject({ message: 'Certificado vencido', status: 400 });
    respond(500, { title: 'stack trace com segredo' });
    await expect(new GatewayClient(cfg).inspect('a', 'b')).rejects.toMatchObject({ message: 'O serviço de notas fiscais respondeu 500', status: 500 });
  });

  it('rede fora do ar vira 503 com mensagem amigável', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(new GatewayClient(cfg).getCompany(CNPJ)).rejects.toMatchObject({ status: 503 });
  });
});

describe('CredentialService em modo gateway: upload = UMA chamada de cadastro', () => {
  const gwCred = { environment: 'PRODUCTION', subject: 'MAX ESHOP LTDA:67278239000107', cert_cnpj: '67278239000107', not_before: '2026-01-01T00:00:00Z', not_after: '2027-07-06T00:00:00Z', enabled: false, auto_manifest: false };
  const input = { pfxBase64: 'UEZY', password: 'senha', environment: 'PRODUCTION' as const };
  const actor = { id: 'u1', ip: '1.1.1.1' };

  function setup(opts: { lastNsu?: bigint; reply?: unknown; certCnpj?: string } = {}) {
    const upserts: Record<string, unknown>[] = [];
    const audits: unknown[] = [];
    const prisma = {
      tenantFiscalSettings: { findUnique: async () => ({ cnpj: '67278239000107', legalName: 'MAX ESHOP', ufCode: 26 }) },
      fiscalSyncState: { findUnique: async () => (opts.lastNsu === undefined ? null : { lastNsu: opts.lastNsu }), upsert: async () => ({}) },
      fiscalCredential: { upsert: async (a: { create: Record<string, unknown> }) => void upserts.push(a.create) },
      fiscalAuditLog: { create: async (a: unknown) => void audits.push(a) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    };
    const register = vi.fn().mockResolvedValue(opts.reply ?? { credential: gwCred, changed: { credential: true, resumed: false } });
    const inspect = vi.fn().mockResolvedValue({ subject: gwCred.subject, certCnpj: opts.certCnpj ?? '67278239000107' });
    const svc = new CredentialService(prisma as never, { available: false } as never, { register, inspect } as unknown as GatewayClient);
    return { svc, register, upserts, audits };
  }

  it('certificado de outra raiz de CNPJ é recusado antes de cadastrar no gateway', async () => {
    const { svc, register, upserts } = setup({ certCnpj: '11222333000181' });
    await expect(svc.upload(input, actor)).rejects.toThrow(/mesma raiz/);
    expect(register).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it('certificado de filial da mesma raiz é aceito', async () => {
    const { svc, register } = setup({ certCnpj: '67278239000298' });
    await svc.upload(input, actor);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('chama o gateway UMA vez para cadastrar, sem flags, e guarda só o espelho (sem .pfx nem senha)', async () => {
    const { svc, register, upserts } = setup();
    const out = await svc.upload(input, actor);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('67278239000107', { legalName: 'MAX ESHOP', ufCode: 26, credential: input }, 'u1');
    expect(upserts[0]).toMatchObject({ keyId: 'gateway', subject: gwCred.subject, certCnpj: '67278239000107', enabled: false });
    expect((upserts[0]!.pfxCiphertext as Buffer).length).toBe(0);
    expect((upserts[0]!.pfxPassCiphertext as Buffer).length).toBe(0);
    expect(out).toMatchObject({ subject: gwCred.subject, certCnpj: '67278239000107' });
  });

  it('tenant que já tinha NSU informa ao gateway (resumeFromNsu)', async () => {
    const { svc, register } = setup({ lastNsu: 221n });
    await svc.upload(input, actor);
    expect(register.mock.calls[0]![1]).toMatchObject({ resumeFromNsu: '221' });
  });

  it('NSU zerado não envia resumeFromNsu', async () => {
    const { svc, register } = setup({ lastNsu: 0n });
    await svc.upload(input, actor);
    expect(register.mock.calls[0]![1]).not.toHaveProperty('resumeFromNsu');
  });

  it('espelha as flags que o gateway devolve (renovação preserva o que já estava ligado)', async () => {
    const { svc, upserts } = setup({ reply: { credential: { ...gwCred, enabled: true, auto_manifest: true }, changed: { credential: true, resumed: false } } });
    await svc.upload(input, actor);
    expect(upserts[0]).toMatchObject({ enabled: true, autoManifest: true });
  });

  it('erro do gateway chega ao usuário com a mensagem dele (400) e nada é gravado', async () => {
    const { svc, register, upserts } = setup();
    register.mockRejectedValue(new GatewayError('Certificado vencido', 400));
    await expect(svc.upload(input, actor)).rejects.toMatchObject({ message: 'Certificado vencido', status: 400 });
    register.mockRejectedValue(new GatewayError('Este CNPJ já está em uso por outro cliente do gateway', 409));
    await expect(svc.upload(input, actor)).rejects.toMatchObject({ status: 409 });
    expect(upserts).toHaveLength(0);
  });

  it('gateway sem resposta de certificado: não grava espelho enganoso', async () => {
    const { svc, upserts } = setup({ reply: { credential: null } });
    await expect(svc.upload(input, actor)).rejects.toThrow(/não confirmou/);
    expect(upserts).toHaveLength(0);
  });

  describe('remover o certificado', () => {
    const build = (deleteCredential: () => Promise<unknown>) => {
      const deleted: unknown[] = [];
      const prisma = {
        tenantFiscalSettings: { findUnique: async () => ({ cnpj: '67278239000107' }) },
        fiscalCredential: { deleteMany: async () => void deleted.push(1) },
        fiscalAuditLog: { create: async () => ({}) },
      };
      const svc = new CredentialService(prisma as never, { available: false } as never, { deleteCredential } as unknown as GatewayClient);
      return { svc, deleted };
    };

    it('apaga no gateway e limpa o espelho local', async () => {
      const del = vi.fn().mockResolvedValue(null);
      const { svc, deleted } = build(del);
      await svc.remove({ id: 'u1' });
      expect(del).toHaveBeenCalledWith('67278239000107', 'u1');
      expect(deleted).toHaveLength(1);
    });

    it('404 do gateway (certificado nunca esteve lá ou o CNPJ é de outro cliente): limpa o espelho local mesmo assim', async () => {
      const { svc, deleted } = build(async () => {
        throw new GatewayError('Empresa não encontrada', 404);
      });
      await expect(svc.remove({ id: 'u1' })).resolves.toBeUndefined();
      expect(deleted).toHaveLength(1);
    });

    it('gateway fora do ar NÃO limpa o espelho (senão o Fixer acharia que o certificado saiu e o gateway ainda o teria)', async () => {
      const { svc, deleted } = build(async () => {
        throw new GatewayError('indisponível', 503);
      });
      await expect(svc.remove({ id: 'u1' })).rejects.toMatchObject({ status: 503 });
      expect(deleted).toHaveLength(0);
    });
  });
});

/**
 * Regressão real: o tipo `GatewayClient | null` é emitido como `Object` pelo TypeScript, então sem `@Inject` o Nest NÃO
 * injetava o cliente (o consumidor ficava inerte e os testes unitários, que constroem a classe na mão, não percebiam).
 * Estes testes usam a injeção de dependência de verdade.
 */
describe('injeção do GatewayClient (DI real do Nest)', () => {
  const client = { marker: 'gateway' } as unknown as GatewayClient;
  const base = [
    { provide: PrismaService, useValue: {} },
    { provide: KEY_PROVIDER, useValue: { available: false } },
    { provide: FISCAL_CONFIG, useValue: { syncEnabled: true, tickMs: 10 } },
    { provide: DFE_SOURCE, useValue: {} },
    { provide: CredentialService, useValue: {} },
    { provide: SyncRunner, useValue: {} },
  ];

  it('com o gateway configurado, TODOS os consumidores recebem o cliente', async () => {
    const mod = await Test.createTestingModule({
      providers: [...base, GatewayConsumer, SyncScheduler, ManifestService, { provide: GATEWAY_CONFIG, useValue: cfg }, { provide: GatewayClient, useValue: client }],
    }).compile();
    expect((mod.get(GatewayConsumer) as unknown as { gateway: unknown }).gateway).toBe(client);
    expect((mod.get(SyncScheduler) as unknown as { gateway: unknown }).gateway).toBe(client);
    expect((mod.get(ManifestService) as unknown as { gateway: unknown }).gateway).toBe(client);
  });

  it('CredentialService também recebe o cliente', async () => {
    const mod = await Test.createTestingModule({
      providers: [{ provide: PrismaService, useValue: {} }, { provide: KEY_PROVIDER, useValue: { available: false } }, CredentialService, { provide: GatewayClient, useValue: client }],
    }).compile();
    expect((mod.get(CredentialService) as unknown as { gateway: unknown }).gateway).toBe(client);
  });

  it('sem gateway (provider devolve null), segue no modo direto', async () => {
    const mod = await Test.createTestingModule({
      providers: [...base, GatewayConsumer, SyncScheduler, { provide: GATEWAY_CONFIG, useValue: null }, { provide: GatewayClient, useValue: null }],
    }).compile();
    expect((mod.get(GatewayConsumer) as unknown as { gateway: unknown }).gateway).toBeNull();
    expect((mod.get(SyncScheduler) as unknown as { gateway: unknown }).gateway).toBeNull();
  });
});
