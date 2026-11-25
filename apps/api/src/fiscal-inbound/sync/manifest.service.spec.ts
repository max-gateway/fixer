import { describe, expect, it, vi } from 'vitest';
import { FakePrisma } from '../../../test/fiscal/fake-prisma.js';
import { makeAccessKey } from '../../../test/fiscal/nfe-xml.js';
import type { CredentialMaterial } from '../credentials/credential.service.js';
import type { EnvEventoResponse, EventResult } from '../parser/event-response.parser.js';
import { SefazNotConfiguredError, SefazTransportError, type DfeSource, type ManifestParams } from '../sefaz/dfe-source.js';
import { MAX_MANIFEST_ATTEMPTS, manifestBackoffMs, ManifestService } from './manifest.service.js';

const NOW = new Date('2026-10-11T12:00:00Z');
const HOUR = 3_600_000;
const CNPJ = '12ABC34501DE35';
const material = { keyPem: 'k', certPem: 'c', chainPem: [], environment: 'HOMOLOGATION' } as unknown as CredentialMaterial;

const ev = (accessKey: string, cStat: number, xMotivo = `m${cStat}`): EventResult => ({ accessKey, cStat, xMotivo, protocol: null });
const lote = (events: EventResult[], batchStatus = 128, batchMotivo = 'Lote de Evento Processado'): EnvEventoResponse => ({
  batchStatus,
  batchMotivo,
  events,
});

class FakeSource implements DfeSource {
  calls: ManifestParams[] = [];
  constructor(private reply: (p: ManifestParams) => EnvEventoResponse | Error) {}
  async distribute(): Promise<never> {
    throw new Error('não esperado');
  }
  async manifest(_m: CredentialMaterial, p: ManifestParams): Promise<EnvEventoResponse> {
    this.calls.push(p);
    const r = this.reply(p);
    if (r instanceof Error) throw r;
    return r;
  }
}

function setup(reply: (p: ManifestParams) => EnvEventoResponse | Error, count = 1) {
  const db = new FakePrisma();
  const keys = Array.from({ length: count }, (_, i) => makeAccessKey('11222333000181', i + 1));
  for (const accessKey of keys) {
    db.invoices.set(accessKey, { id: `i-${accessKey}`, accessKey, status: 'SUMMARY', manifestAttempts: 0, manifestError: null, manifestNextAt: null, receivedAt: new Date(keys.indexOf(accessKey)) });
  }
  const source = new FakeSource(reply);
  const credentials = { openMaterial: async () => material };
  const service = new ManifestService(db as never, credentials as never, source);
  return { db, source, service, keys, inv: (k: string) => db.invoices.get(k)! };
}

describe('ManifestService.runPending', () => {
  it('135 (registrada e vinculada) → MANIFESTED', async () => {
    const { service, inv, keys } = setup((p) => lote(p.accessKeys.map((k) => ev(k, 135))));
    const s = await service.runPending(material, CNPJ, NOW);
    expect(s).toMatchObject({ manifested: 1, rejected: 0, ignored: 0, aborted: null });
    expect(inv(keys[0]!)).toMatchObject({ status: 'MANIFESTED', manifestedAt: NOW, manifestError: null, manifestNextAt: null });
  });

  it.each([573, 655])('%i (já manifestada / manifestação final já existe) também libera o XML → MANIFESTED', async (cStat) => {
    const { service, inv, keys } = setup((p) => lote(p.accessKeys.map((k) => ev(k, cStat))));
    await service.runPending(material, CNPJ, NOW);
    expect(inv(keys[0]!).status).toBe('MANIFESTED');
  });

  it('650 (NF-e cancelada ou denegada) e 596 (fora do prazo) viram IGNORED com o motivo, sem nova tentativa', async () => {
    const { service, inv, keys } = setup((p) => lote([ev(p.accessKeys[0]!, 650), ev(p.accessKeys[1]!, 596, 'Evento apresentado fora do prazo')]), 2);
    const s = await service.runPending(material, CNPJ, NOW);
    expect(s.ignored).toBe(2);
    expect(inv(keys[0]!)).toMatchObject({ status: 'IGNORED', ignoredReason: 'CANCELED_OR_DENIED' });
    expect(inv(keys[1]!)).toMatchObject({ status: 'IGNORED', ignoredReason: 'MANIFEST_DEADLINE' });
  });

  it('136 (registrada sem vínculo) e demais rejeições: continua SUMMARY, com erro e backoff', async () => {
    const { service, inv, keys } = setup((p) => lote([ev(p.accessKeys[0]!, 136, 'nao vinculado'), ev(p.accessKeys[1]!, 572, 'Id difere')]), 2);
    const s = await service.runPending(material, CNPJ, NOW);
    expect(s).toMatchObject({ rejected: 2, manifested: 0 });
    expect(inv(keys[0]!)).toMatchObject({ status: 'SUMMARY', manifestAttempts: 1, manifestError: '136 nao vinculado' });
    expect(inv(keys[1]!).manifestError).toBe('572 Id difere');
    expect(inv(keys[0]!).manifestNextAt.getTime()).toBe(NOW.getTime() + HOUR);
  });

  it('backoff dobra por tentativa (1, 2, 4, 8, 16 h) e trava em 24 h', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => manifestBackoffMs(n) / HOUR)).toEqual([1, 2, 4, 8, 16, 24, 24]);
  });

  it('nota ainda em espera (manifestNextAt futuro) e nota com tentativas esgotadas não são enviadas', async () => {
    const { service, db, source, keys } = setup((p) => lote(p.accessKeys.map((k) => ev(k, 135))), 3);
    db.invoices.get(keys[0]!)!.manifestNextAt = new Date(NOW.getTime() + HOUR);
    db.invoices.get(keys[1]!)!.manifestAttempts = MAX_MANIFEST_ATTEMPTS;
    await service.runPending(material, CNPJ, NOW);
    expect(source.calls[0]!.accessKeys).toEqual([keys[2]]);
    // depois que a espera vence, a primeira volta
    await service.runPending(material, CNPJ, new Date(NOW.getTime() + 2 * HOUR));
    expect(source.calls[1]!.accessKeys).toEqual([keys[0]]);
  });

  it('esgotadas as tentativas a nota fica SUMMARY com o último erro visível e nunca mais é escolhida sozinha', async () => {
    const { service, inv, keys, source } = setup((p) => lote(p.accessKeys.map((k) => ev(k, 215, 'Falha Schema'))));
    let now = NOW;
    for (let i = 0; i < MAX_MANIFEST_ATTEMPTS + 2; i++) {
      await service.runPending(material, CNPJ, now);
      now = new Date(now.getTime() + 48 * HOUR);
    }
    expect(source.calls).toHaveLength(MAX_MANIFEST_ATTEMPTS);
    expect(inv(keys[0]!)).toMatchObject({ status: 'SUMMARY', manifestAttempts: MAX_MANIFEST_ATTEMPTS, manifestError: '215 Falha Schema' });
  });

  it('lote rejeitado como um todo (ex.: 215 schema) conta tentativa em todas as notas', async () => {
    const { service, inv, keys } = setup(() => lote([], 215, 'Falha no Schema XML'), 2);
    const s = await service.runPending(material, CNPJ, NOW);
    expect(s.rejected).toBe(2);
    expect(inv(keys[1]!)).toMatchObject({ manifestAttempts: 1, manifestError: '215 Falha no Schema XML' });
  });

  it('serviço parado (108/109): interrompe sem penalizar nenhuma nota', async () => {
    const { service, inv, keys } = setup(() => lote([], 108, 'Servico Paralisado Momentaneamente'));
    const s = await service.runPending(material, CNPJ, NOW);
    expect(s.aborted).toMatch(/108/);
    expect(inv(keys[0]!)).toMatchObject({ manifestAttempts: 0, manifestError: null });
  });

  it('falha de rede: interrompe a rodada sem penalizar as notas', async () => {
    const { service, inv, keys } = setup(() => new SefazTransportError('Falha de rede/TLS: ECONNRESET'), 2);
    const s = await service.runPending(material, CNPJ, NOW);
    expect(s.aborted).toMatch(/ECONNRESET/);
    expect(inv(keys[0]!).manifestAttempts).toBe(0);
    expect(inv(keys[1]!).manifestAttempts).toBe(0);
  });

  it('URL do serviço de eventos não configurada: interrompe, sem penalizar', async () => {
    const { service, inv, keys } = setup(() => new SefazNotConfiguredError('URL do NFeRecepcaoEvento não configurada'));
    expect((await service.runPending(material, CNPJ, NOW)).aborted).toMatch(/não configurada/);
    expect(inv(keys[0]!).manifestAttempts).toBe(0);
  });

  it('erro inesperado (bug) propaga em vez de ser mascarado como falha de rede', async () => {
    const { service } = setup(() => new TypeError('bug'));
    await expect(service.runPending(material, CNPJ, NOW)).rejects.toThrow('bug');
  });

  it('a SEFAZ não devolve resultado para a chave: conta como rejeição', async () => {
    const { service, inv, keys } = setup(() => lote([]));
    await service.runPending(material, CNPJ, NOW);
    expect(inv(keys[0]!)).toMatchObject({ manifestAttempts: 1, manifestError: 'A SEFAZ não devolveu resultado para o evento' });
  });

  it('manda em lotes de no máximo 20, da nota mais antiga para a mais nova, com o CNPJ do destinatário', async () => {
    const { service, source, keys } = setup((p) => lote(p.accessKeys.map((k) => ev(k, 135))), 45);
    const s = await service.runPending(material, CNPJ, NOW);
    expect(s.manifested).toBe(45);
    expect(source.calls.map((c) => c.accessKeys.length)).toEqual([20, 20, 5]);
    expect(source.calls.flatMap((c) => c.accessKeys)).toEqual(keys);
    expect(source.calls.every((c) => c.cnpj === CNPJ)).toBe(true);
  });

  it('só considera notas SUMMARY; nota que já virou FULL no meio do caminho não é sobrescrita', async () => {
    const { service, db, inv, keys } = setup((p) => {
      db.invoices.get(p.accessKeys[0]!)!.status = 'FULL'; // o XML completo chegou enquanto a ciência estava em voo
      return lote(p.accessKeys.map((k) => ev(k, 135)));
    });
    await service.runPending(material, CNPJ, NOW);
    expect(inv(keys[0]!).status).toBe('FULL');
  });

  it('sem notas pendentes não chama a SEFAZ', async () => {
    const { service, db, source } = setup(() => lote([]), 0);
    expect(db.invoices.size).toBe(0);
    expect(await service.runPending(material, CNPJ, NOW)).toMatchObject({ manifested: 0, aborted: null });
    expect(source.calls).toHaveLength(0);
  });
});

describe('ManifestService.manifestOne (botão manual)', () => {
  function manual(reply: (p: ManifestParams) => EnvEventoResponse | Error) {
    const s = setup(reply);
    const service = new ManifestService(s.db as never, { openMaterial: async () => material } as never, s.source);
    const id = `i-${s.keys[0]}`;
    return { ...s, service, id };
  }

  it('registra a ciência e devolve o novo estado', async () => {
    const { service, id, source } = manual((p) => lote(p.accessKeys.map((k) => ev(k, 135))));
    expect(await service.manifestOne(id, NOW)).toEqual({ status: 'MANIFESTED', message: null });
    expect(source.calls[0]).toMatchObject({ cnpj: CNPJ });
  });

  it('repetir depois de esgotar as tentativas automáticas: zera a contagem e tenta', async () => {
    const { service, id, inv, keys } = manual((p) => lote(p.accessKeys.map((k) => ev(k, 135))));
    inv(keys[0]!).manifestAttempts = MAX_MANIFEST_ATTEMPTS;
    inv(keys[0]!).manifestError = '215 Falha Schema';
    expect((await service.manifestOne(id, NOW)).status).toBe('MANIFESTED');
  });

  it('rejeição aparece na resposta, e a nota segue SUMMARY', async () => {
    const { service, id } = manual((p) => lote(p.accessKeys.map((k) => ev(k, 572, 'Id difere'))));
    expect(await service.manifestOne(id, NOW)).toEqual({ status: 'SUMMARY', message: '572 Id difere' });
  });

  it('nota inexistente → 404; nota que não é resumo → 409', async () => {
    const { service, inv, keys, id } = manual((p) => lote(p.accessKeys.map((k) => ev(k, 135))));
    await expect(service.manifestOne('nao-existe')).rejects.toMatchObject({ status: 404 });
    inv(keys[0]!).status = 'FULL';
    await expect(service.manifestOne(id)).rejects.toMatchObject({ status: 409 });
  });

  it('SEFAZ fora do ar → 502; sem CNPJ cadastrado → 503', async () => {
    const down = manual(() => new SefazTransportError('Falha de rede/TLS: ETIMEDOUT'));
    await expect(down.service.manifestOne(down.id)).rejects.toMatchObject({ status: 502 });
    const noCnpj = manual((p) => lote(p.accessKeys.map((k) => ev(k, 135))));
    noCnpj.db.settings = { id: 1, cnpj: null };
    await expect(noCnpj.service.manifestOne(noCnpj.id)).rejects.toMatchObject({ status: 503 });
  });
});

describe('vi sanity', () => {
  it('o filtro do FakePrisma reflete o do serviço (guarda contra teste vazio)', async () => {
    const { service, source } = setup((p) => lote(p.accessKeys.map((k) => ev(k, 135))), 2);
    const spy = vi.spyOn(source, 'manifest');
    await service.runPending(material, CNPJ, NOW);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
