import { describe, expect, it, vi } from 'vitest';
import { FakePrisma } from '../../../test/fiscal/fake-prisma.js';
import { makeDistResponse, makeProcNfe, makeResNfe } from '../../../test/fiscal/nfe-xml.js';
import type { CredentialMaterial } from '../credentials/credential.service.js';
import { PfxError } from '../credentials/pfx.js';
import { parseDistResponse, type DistResult } from '../parser/dist-response.parser.js';
import { SefazNotConfiguredError, SefazTransportError, type DfeSource, type DistributeParams, type ManifestParams } from '../sefaz/dfe-source.js';
import type { EnvEventoResponse } from '../parser/event-response.parser.js';
import { SyncRunner } from './sync.runner.js';

const NOW = new Date('2026-10-11T12:00:00Z');
const MIN = 60_000;
const material = (over: Partial<CredentialMaterial> = {}): CredentialMaterial => ({
  keyPem: 'k',
  certPem: 'c',
  chainPem: [],
  subject: 'x',
  certCnpj: '12ABC34501DE35',
  notBefore: new Date('2026-01-01'),
  notAfter: new Date('2027-01-01'),
  environment: 'HOMOLOGATION',
  ...over,
});

/** Fonte falsa: responde o roteiro em ordem e registra com que NSU foi chamada. */
class ScriptedSource implements DfeSource {
  calls: DistributeParams[] = [];
  constructor(private script: (DistResult | Error)[]) {}
  async distribute(_m: CredentialMaterial, params: DistributeParams): Promise<DistResult> {
    this.calls.push(params);
    const next = this.script.shift();
    if (!next) throw new Error('roteiro esgotado');
    if (next instanceof Error) throw next;
    return next;
  }
  async manifest(_m: CredentialMaterial, _p: ManifestParams): Promise<EnvEventoResponse> {
    throw new Error('manifest não esperado neste teste');
  }
}
const dist = (o: Parameters<typeof makeDistResponse>[0]) => parseDistResponse(makeDistResponse(o));

function setup(script: (DistResult | Error)[], opts: { material?: () => Promise<CredentialMaterial> } = {}) {
  const db = new FakePrisma();
  const source = new ScriptedSource(script);
  const credentials = { openMaterial: opts.material ?? (async () => material()) };
  const manifest = { runPending: vi.fn().mockResolvedValue({ manifested: 0, rejected: 0, ignored: 0, aborted: null }) };
  const runner = new SyncRunner(db as never, credentials as never, source, manifest as never);
  return { db, source, runner, manifest, run: () => runner.runOnce(NOW, () => 0) };
}

const proc = (number: number) => makeProcNfe({ number });

describe('SyncRunner: lote e NSU', () => {
  it('grava o lote, avança o NSU na mesma transação e continua quando há mais', async () => {
    const a = proc(1);
    const b = proc(2);
    const { db, run, source } = setup([
      dist({
        cStat: 138,
        ultNSU: '2',
        maxNSU: '9',
        docs: [
          { nsu: '1', schema: 'procNFe_v4.00.xsd', xml: a.xml },
          { nsu: '2', schema: 'procNFe_v4.00.xsd', xml: b.xml },
        ],
      }),
    ]);
    db.state!.lastNsu = 0n;
    const r = await run();

    expect(r).toMatchObject({ outcome: 'MORE', cStat: 138, counters: { full: 2 } });
    expect(db.state).toMatchObject({ lastNsu: 2n, maxNsu: 9n, consecutiveFailures: 0, lastStatusCode: 138, lastError: null, lastSuccessAt: NOW });
    expect(db.state!.nextPollAt.getTime()).toBe(NOW.getTime() + 1_000);
    expect(db.invoices.size).toBe(2);
    expect(source.calls[0]).toMatchObject({ cnpj: '12ABC34501DE35', ufCode: 35, ultNsu: 0n });
  });

  it('pede a próxima página a partir do último NSU gravado', async () => {
    const { db, run, source } = setup([
      dist({ cStat: 138, ultNSU: '50', maxNSU: '60', docs: [{ nsu: '50', schema: 'procNFe_v4.00.xsd', xml: proc(1).xml }] }),
      dist({ cStat: 138, ultNSU: '60', maxNSU: '60', docs: [{ nsu: '60', schema: 'procNFe_v4.00.xsd', xml: proc(2).xml }] }),
    ]);
    expect((await run()).outcome).toBe('MORE');
    const second = await run();
    expect(second.outcome).toBe('IDLE'); // ultNSU = maxNSU: fila esgotada
    expect(source.calls.map((c) => c.ultNsu)).toEqual([0n, 50n]);
    expect(db.state!.lastNsu).toBe(60n);
    expect(db.state!.nextPollAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 60 * MIN);
  });

  it('documentos sem atributo NSU (facultativo na NT): avança pelo ultNSU da resposta', async () => {
    const { db, run } = setup([
      dist({ cStat: 138, ultNSU: '40', maxNSU: '40', docs: [{ schema: 'procNFe_v4.00.xsd', xml: proc(1).xml }] }),
    ]);
    await run();
    expect(db.state!.lastNsu).toBe(40n);
    expect(db.invoices.size).toBe(1);
  });

  it('reprocessar o mesmo lote não duplica nota nem item', async () => {
    const a = proc(1);
    const batch = () => dist({ cStat: 138, ultNSU: '5', maxNSU: '5', docs: [{ nsu: '5', schema: 'procNFe_v4.00.xsd', xml: a.xml }] });
    const { db, run } = setup([batch(), batch()]);
    await run();
    db.state!.lastNsu = 0n; // simula reentrega do mesmo lote
    await run();
    expect(db.invoices.size).toBe(1);
    expect(db.itemsOf(a.key)).toHaveLength(2);
  });

  it('erro de banco no meio do lote: rollback total, NSU não anda, próxima rodada reprocessa', async () => {
    const a = proc(1);
    const b = proc(2);
    const batch = () =>
      dist({
        cStat: 138,
        ultNSU: '2',
        maxNSU: '2',
        docs: [
          { nsu: '1', schema: 'procNFe_v4.00.xsd', xml: a.xml },
          { nsu: '2', schema: 'procNFe_v4.00.xsd', xml: b.xml },
        ],
      });
    const { db, run } = setup([batch(), batch()]);
    let created = 0;
    db.onInvoiceCreate = () => {
      if (++created === 2) throw new Error('conexão perdida');
    };

    const failed = await run();
    expect(failed.outcome).toBe('RETRY');
    expect(db.invoices.size).toBe(0); // a 1ª nota foi desfeita junto
    expect(db.state).toMatchObject({ lastNsu: 0n, consecutiveFailures: 1, lastError: 'Falha ao gravar o lote no banco' });
    expect(db.state!.nextPollAt.getTime()).toBe(NOW.getTime() + 1 * MIN);

    db.onInvoiceCreate = null;
    const ok = await run();
    expect(ok.outcome).toBe('IDLE');
    expect(db.state).toMatchObject({ lastNsu: 2n, consecutiveFailures: 0, lastError: null });
    expect(db.invoices.size).toBe(2);
  });

  it('documento ruim no lote não trava a fila: conta como inválido e o NSU avança', async () => {
    const { db, run } = setup([
      dist({
        cStat: 138,
        ultNSU: '3',
        maxNSU: '3',
        docs: [
          { nsu: '1', schema: 'procNFe_v4.00.xsd', xml: '<lixo' },
          { nsu: '2', schema: 'resNFe_v1.00.xsd', xml: makeResNfe('k'.repeat(44)) },
          { nsu: '3', schema: 'procNFe_v4.00.xsd', xml: proc(1).xml },
        ],
      }),
    ]);
    const r = await run();
    expect(r.counters).toMatchObject({ invalid: 2, full: 1 });
    expect(db.state!.lastNsu).toBe(3n);
  });

  it('138 sem ultNSU não pode andar a fila: falha em vez de repetir o lote para sempre', async () => {
    const { db, run } = setup([dist({ cStat: 138, docs: [{ nsu: '1', schema: 'procNFe_v4.00.xsd', xml: proc(1).xml }] })]);
    const r = await run();
    expect(r.outcome).toBe('RETRY');
    expect(db.invoices.size).toBe(0);
    expect(db.state).toMatchObject({ lastNsu: 0n, lastError: 'Resposta 138 sem ultNSU' });
  });

  it('o NSU nunca recua, mesmo se a SEFAZ responder um valor menor', async () => {
    const { db, run } = setup([dist({ cStat: 137, ultNSU: '3', maxNSU: '3' })]);
    db.state!.lastNsu = 10n;
    await run();
    expect(db.state!.lastNsu).toBe(10n);
  });
});

describe('SyncRunner: respostas da SEFAZ', () => {
  it('137: espera 1 h e marca sucesso', async () => {
    const { db, run } = setup([dist({ cStat: 137, ultNSU: '0', maxNSU: '0' })]);
    const r = await run();
    expect(r).toMatchObject({ outcome: 'IDLE', cStat: 137 });
    expect(db.state!.nextPollAt.getTime()).toBe(NOW.getTime() + 60 * MIN);
    expect(db.state).toMatchObject({ lastSuccessAt: NOW, lastStatusCode: 137 });
  });

  it('656: espera 65 min, não mexe no NSU e registra o NSU que a SEFAZ conhece', async () => {
    const { db, run } = setup([dist({ cStat: 656, ultNSU: '777', xMotivo: 'Rejeicao: Consumo Indevido' })]);
    db.state!.lastNsu = 5n;
    const r = await run();
    expect(r.outcome).toBe('BLOCKED');
    expect(db.state).toMatchObject({ lastNsu: 5n, consecutiveFailures: 1, lastStatusCode: 656 });
    expect(db.state!.lastError).toContain('777');
    expect(db.state!.nextPollAt.getTime()).toBe(NOW.getTime() + 65 * MIN);
    expect(db.state!.lastSuccessAt).toBeUndefined();
  });

  it('656 três vezes seguidas desliga a sincronização', async () => {
    const { db, run } = setup([dist({ cStat: 656, ultNSU: '1' }), dist({ cStat: 656, ultNSU: '1' }), dist({ cStat: 656, ultNSU: '1' })]);
    await run();
    await run();
    expect(db.credential!.enabled).toBe(true);
    const third = await run();
    expect(third.outcome).toBe('DISABLE');
    expect(db.credential!.enabled).toBe(false);
    expect(db.state!.lastError).toMatch(/desligada/);
  });

  it('rejeição de certificado/CNPJ (593) desliga e não repete', async () => {
    const { db, run } = setup([dist({ cStat: 593, xMotivo: 'CNPJ-Base consultado difere do CNPJ-Base do Certificado Digital' })]);
    const r = await run();
    expect(r.outcome).toBe('DISABLE');
    expect(db.credential!.enabled).toBe(false);
    expect(db.state!.lastError).toContain('593');
  });

  it('falha de rede acumula backoff e a primeira resposta boa zera tudo', async () => {
    const { db, run } = setup([
      new SefazTransportError('Falha de rede/TLS: ECONNRESET'),
      new SefazTransportError('SEFAZ respondeu HTTP 503', 503),
      dist({ cStat: 137, ultNSU: '0', maxNSU: '0' }),
    ]);
    expect((await run()).outcome).toBe('RETRY');
    expect(db.state).toMatchObject({ consecutiveFailures: 1, lastError: 'Falha de rede/TLS: ECONNRESET' });
    await run();
    expect(db.state!.consecutiveFailures).toBe(2);
    expect(db.state!.nextPollAt.getTime()).toBe(NOW.getTime() + 2 * MIN);
    await run();
    expect(db.state).toMatchObject({ consecutiveFailures: 0, lastError: null });
  });

  it('URL da SEFAZ não configurada é erro de configuração com backoff, não desliga', async () => {
    const { db, run } = setup([new SefazNotConfiguredError('URL do NFeDistribuicaoDFe não configurada (FISCAL_DIST_URL_HOMOLOGATION)')]);
    const r = await run();
    expect(r.outcome).toBe('RETRY');
    expect(db.credential!.enabled).toBe(true);
    expect(db.state!.lastError).toContain('FISCAL_DIST_URL_HOMOLOGATION');
  });

  it('erro inesperado do cliente propaga (bug), sem mascarar como falha de rede', async () => {
    const { run } = setup([new TypeError('bug')]);
    await expect(run()).rejects.toThrow('bug');
  });
});

describe('SyncRunner: pré-condições', () => {
  it('sem certificado cadastrado não faz nada', async () => {
    const { db, run, source } = setup([]);
    db.state = null;
    expect((await run()).outcome).toBe('IDLE');
    expect(source.calls).toHaveLength(0);
  });

  it('sem CNPJ da empresa: falha com mensagem clara, sem chamar a SEFAZ', async () => {
    const { db, run, source } = setup([]);
    db.settings = { id: 1, cnpj: null };
    const r = await run();
    expect(r.outcome).toBe('RETRY');
    expect(db.state!.lastError).toMatch(/CNPJ da empresa/);
    expect(source.calls).toHaveLength(0);
  });

  it('certificado vencido desliga sem chamar a SEFAZ', async () => {
    const { db, run, source } = setup([], { material: async () => material({ notAfter: new Date(NOW.getTime() - 1) }) });
    const r = await run();
    expect(r.outcome).toBe('DISABLE');
    expect(db.credential!.enabled).toBe(false);
    expect(db.state!.lastError).toMatch(/vencido/);
    expect(source.calls).toHaveLength(0);
  });

  it('certificado que não decifra (chave mestra perdida) desliga e pede novo envio, sem vazar o motivo interno', async () => {
    const { db, run } = setup([], {
      material: async () => {
        throw new Error('Unsupported state or unable to authenticate data');
      },
    });
    const r = await run();
    expect(r.outcome).toBe('DISABLE');
    expect(db.state!.lastError).toBe('Não foi possível decifrar o certificado. Reenvie o certificado');
    expect(db.credential!.enabled).toBe(false);
  });

  it('.pfx ilegível ao abrir: usa a mensagem segura do PfxError', async () => {
    const { db, run } = setup([], {
      material: async () => {
        throw new PfxError('WRONG_PASSWORD', 'Senha do certificado incorreta');
      },
    });
    await run();
    expect(db.state!.lastError).toContain('Senha do certificado incorreta');
  });

  it('passa o ambiente do certificado à fonte', async () => {
    const spy = vi.fn(async (_m: CredentialMaterial, _p: DistributeParams) => dist({ cStat: 137, ultNSU: '0', maxNSU: '0' }));
    const db = new FakePrisma();
    const runner = new SyncRunner(
      db as never,
      { openMaterial: async () => material({ environment: 'PRODUCTION' }) } as never,
      { distribute: spy, manifest: vi.fn() },
      { runPending: vi.fn() } as never,
    );
    await runner.runOnce(NOW, () => 0);
    expect(spy.mock.calls[0]![0]).toMatchObject({ environment: 'PRODUCTION' });
  });
});

describe('SyncRunner: ciência automática (autoManifest)', () => {
  const ok137 = () => dist({ cStat: 137, ultNSU: '0', maxNSU: '0' });

  it('desligada (padrão): nunca manifesta', async () => {
    const { run, manifest } = setup([ok137()]);
    await run();
    expect(manifest.runPending).not.toHaveBeenCalled();
  });

  it('ligada: depois de uma rodada bem-sucedida dá ciência, com o certificado e o CNPJ do tenant', async () => {
    const { db, run, manifest } = setup([ok137()]);
    db.credential!.autoManifest = true;
    await run();
    expect(manifest.runPending).toHaveBeenCalledTimes(1);
    expect(manifest.runPending.mock.calls[0]![1]).toBe('12ABC34501DE35');
    expect(manifest.runPending.mock.calls[0]![2]).toEqual(NOW);
  });

  it('também roda quando o lote tem mais páginas (MORE), para a ciência não esperar a fila inteira', async () => {
    const { db, run, manifest } = setup([dist({ cStat: 138, ultNSU: '1', maxNSU: '9', docs: [{ nsu: '1', schema: 'resNFe_v1.00.xsd', xml: makeResNfe(proc(1).key) }] })]);
    db.credential!.autoManifest = true;
    expect((await run()).outcome).toBe('MORE');
    expect(manifest.runPending).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['656 (bloqueado)', () => dist({ cStat: 656, ultNSU: '1' })],
    ['rejeição de certificado', () => dist({ cStat: 593 })],
    ['falha de rede', () => new SefazTransportError('timeout')],
  ])('não manifesta depois de %s', async (_n, step) => {
    const { db, run, manifest } = setup([step()]);
    db.credential!.autoManifest = true;
    await run();
    expect(manifest.runPending).not.toHaveBeenCalled();
  });

  it('falha na ciência é isolada: o NSU e o resultado da rodada ficam como estavam', async () => {
    const { db, run, manifest } = setup([
      dist({ cStat: 138, ultNSU: '3', maxNSU: '3', docs: [{ nsu: '3', schema: 'procNFe_v4.00.xsd', xml: proc(1).xml }] }),
    ]);
    db.credential!.autoManifest = true;
    manifest.runPending.mockRejectedValueOnce(new Error('boom'));
    const r = await run();
    expect(r.outcome).toBe('IDLE');
    expect(db.state).toMatchObject({ lastNsu: 3n, consecutiveFailures: 0, lastError: null });
    expect(db.invoices.size).toBe(1);
  });
});
