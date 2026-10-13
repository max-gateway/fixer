import { describe, expect, it, vi } from 'vitest';
import { CnpjLookupClient } from './cnpj-lookup.client.js';
import { CnpjLookupService, InvalidCnpjError } from './cnpj-lookup.service.js';

const raw = {
  cnpj: '00000000000191',
  razao_social: 'BANCO DO BRASIL SA',
  situacao: 'Ativa',
  endereco: { uf: 'DF', cep: '70040912' },
  telefones: ['6134939002'],
  emails: [],
  inscricoes_estaduais: [{ numero: '0809427800174', uf: 'DF', situacao: 'Sem restrição', campoNovo: 1 }],
  raw: { naoSai: true },
};

function make() {
  const client = { consultaCnpj: vi.fn().mockResolvedValue(raw) };
  return { client, service: new CnpjLookupService(client as unknown as CnpjLookupClient) };
}

describe('CnpjLookupService', () => {
  it('normaliza a máscara e devolve só o contrato (sem raw)', async () => {
    const { client, service } = make();
    const r = await service.lookup('00.000.000-000191');
    expect(client.consultaCnpj).toHaveBeenCalledWith('00000000000191');
    expect(r.inscricoes_estaduais[0]?.numero).toBe('0809427800174');
    expect(r).not.toHaveProperty('raw');
  });

  it('extrai município (IBGE) e opção pelo Simples do raw do CNPJá', async () => {
    const client = {
      consultaCnpj: vi.fn().mockResolvedValue({
        ...raw,
        raw: { address: { municipality: 3550308 }, company: { simples: { optant: true }, simei: { optant: false } } },
      }),
    };
    const r = await new CnpjLookupService(client as unknown as CnpjLookupClient).lookup('00000000000191');
    expect(r.fiscal).toEqual({ municipalityIbge: '3550308', simples: true });
  });

  it('sem os dados no raw, não chuta: tudo null', async () => {
    const { service } = make();
    expect((await service.lookup('00000000000191')).fiscal).toEqual({ municipalityIbge: null, simples: null });
  });

  it('rejeita CNPJ inválido sem chamar o microservice', async () => {
    const { client, service } = make();
    await expect(service.lookup('00000000000192')).rejects.toBeInstanceOf(InvalidCnpjError);
    expect(client.consultaCnpj).not.toHaveBeenCalled();
  });
});
