import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegraContadorClient } from './integra-contador.client.js';

const CNPJ = '63790924000159';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const expired = () => json(401, { error: { code: 'AUTORIZACAO_EXPIRADA', message: 'envie um termo novo' }, detail: 'envie um termo novo' });
const rbt12Ok = { pa: '202610', rbt12: '447782.01', numeroDeclaracao: '1', rbt12Real: '410466.84', proporcional: true, mesesAtividade: 11, fatos: { periodoDeclaracao: '202609' } };

describe('IntegraContadorClient', () => {
  const fetchMock = vi.fn();
  const gateway = { signIntegraTerm: vi.fn() };

  beforeEach(() => {
    process.env.INTEGRA_CONTADOR_URL = 'http://integra.test/';
    process.env.INTEGRA_CONTADOR_API_KEY = 'k';
    vi.stubGlobal('fetch', fetchMock);
    gateway.signIntegraTerm.mockResolvedValue({ xml: '<termoDeAutorizacao/>', vigencia: '20261231' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    gateway.signIntegraTerm.mockReset();
    delete process.env.INTEGRA_CONTADOR_URL;
    delete process.env.INTEGRA_CONTADOR_API_KEY;
  });
  const urls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit).method} ${(c[0] as string).replace('http://integra.test', '')}`);

  it('desligado sem URL', () => {
    delete process.env.INTEGRA_CONTADOR_URL;
    expect(new IntegraContadorClient().enabled).toBe(false);
  });

  it('com termo válido: uma chamada só, com a chave do cliente', async () => {
    fetchMock.mockResolvedValueOnce(json(200, rbt12Ok));
    const r = await new IntegraContadorClient(gateway as never).rbt12(CNPJ, '202610');
    expect(r).toEqual({ status: 'OK', data: rbt12Ok });
    expect(urls()).toEqual([`GET /v1/simples/rbt12/${CNPJ}?pa=202610`]);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer k' });
  });

  it('AUTORIZACAO_EXPIRADA: o gateway assina um termo novo, o serviço o recebe e a consulta se repete uma vez', async () => {
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(200, { cnpj: '67278239000107', nome: 'MAX ESHOP LTDA' }))
      .mockResolvedValueOnce(json(200, { cnpj: CNPJ, expires_at: '2026-10-22T00:00:01' }))
      .mockResolvedValueOnce(json(200, rbt12Ok));
    const r = await new IntegraContadorClient(gateway as never).rbt12(CNPJ, '202610');
    expect(r.status).toBe('OK');
    expect(gateway.signIntegraTerm).toHaveBeenCalledWith(CNPJ, { cnpj: '67278239000107', nome: 'MAX ESHOP LTDA' }, 'fiscal-autofill');
    expect(urls()).toEqual([`GET /v1/simples/rbt12/${CNPJ}?pa=202610`, 'GET /v1/contratante', 'POST /v1/autorizacao', `GET /v1/simples/rbt12/${CNPJ}?pa=202610`]);
    expect(JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string)).toEqual({ cnpj: CNPJ, termo_assinado_xml: '<termoDeAutorizacao/>' });
  });

  it('se continuar expirada depois de renovar, não entra em laço', async () => {
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(200, { cnpj: '67278239000107', nome: 'MAX ESHOP LTDA' }))
      .mockResolvedValueOnce(json(200, { cnpj: CNPJ }))
      .mockResolvedValueOnce(expired());
    const r = await new IntegraContadorClient(gateway as never).rbt12(CNPJ, '202610');
    expect(r.status).toBe('FALHOU');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('sem gateway não há quem assine: falha explicada, sem chamar o serviço de novo', async () => {
    fetchMock.mockResolvedValueOnce(expired());
    const r = await new IntegraContadorClient(null).rbt12(CNPJ, '202610');
    expect(r).toMatchObject({ status: 'FALHOU', detail: expect.stringContaining('dfe-gateway') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('o gateway recusar assinar (certificado vencido) vira falha com a mensagem dele, sem entregar nada ao serviço', async () => {
    fetchMock.mockResolvedValueOnce(expired()).mockResolvedValueOnce(json(200, { cnpj: '67278239000107', nome: 'MAX ESHOP LTDA' }));
    gateway.signIntegraTerm.mockRejectedValue(new Error('Certificado vencido'));
    const r = await new IntegraContadorClient(gateway as never).rbt12(CNPJ, '202610');
    expect(r).toMatchObject({ status: 'FALHOU' });
    expect(urls()).not.toContain('POST /v1/autorizacao');
  });

  it('403 do SERPRO e 404 sem declaração mantêm o significado de antes', async () => {
    const c = new IntegraContadorClient(gateway as never);
    fetchMock.mockResolvedValueOnce(json(403, { error: { code: 'SEM_AUTORIZACAO' }, detail: 'x' }));
    expect(await c.rbt12(CNPJ, '202610')).toEqual({ status: 'SEM_AUTORIZACAO' });
    fetchMock.mockResolvedValueOnce(json(404, { error: { code: 'SEM_DECLARACAO' }, detail: 'Sem declaração' }));
    expect(await c.rbt12(CNPJ, '202610')).toEqual({ status: 'SEM_DADO', detail: 'Sem declaração' });
  });

  it('serviço fora do ar vira falha, não exceção', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await new IntegraContadorClient(gateway as never).rbt12(CNPJ, '202610')).toMatchObject({ status: 'FALHOU' });
  });
});
