import { Injectable } from '@nestjs/common';
import { isValidCnpj, normalizeCnpj } from '../fiscal-inbound/cnpj.js';
import { CnpjLookupClient } from './cnpj-lookup.client.js';
import { CnpjLookupResultSchema, fiscalHintsFromRaw, type CnpjFiscalHints, type CnpjLookupResult } from './schema.js';

export class InvalidCnpjError extends Error {
  constructor(input: string) {
    super(`CNPJ inválido: ${input}`);
  }
}

/**
 * Consulta dados cadastrais e Inscrições Estaduais de um CNPJ no cadastro de
 * cliente. Cada consulta consome créditos do CNPJá, então só é chamada pelo
 * usuário no formulário (não em listagens nem em lote), e nada é persistido
 * aqui: quem grava é o POST /customers, com `registryCheckedAt`.
 */
@Injectable()
export class CnpjLookupService {
  constructor(private readonly client: CnpjLookupClient) {}

  async lookup(rawCnpj: string): Promise<CnpjLookupResult & { fiscal: CnpjFiscalHints }> {
    const cnpj = normalizeCnpj(rawCnpj);
    if (!isValidCnpj(cnpj)) throw new InvalidCnpjError(rawCnpj);
    // `raw` do serviço = resposta original do CNPJá; dele saem o IBGE do município e a opção pelo Simples.
    const raw = await this.client.consultaCnpj(cnpj);
    return { ...CnpjLookupResultSchema.parse(raw), fiscal: fiscalHintsFromRaw((raw as { raw?: unknown } | null)?.raw) };
  }
}
