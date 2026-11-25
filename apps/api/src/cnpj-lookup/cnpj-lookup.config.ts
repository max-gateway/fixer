import { Injectable } from '@nestjs/common';

@Injectable()
export class CnpjLookupConfig {
  // Base URL do serviço de consulta de CNPJ da plataforma, não do CNPJá diretamente —
  // o core nunca fala com o CNPJá nem guarda a chave dele.
  // Duas formas, escolhidas só por configuração (o código é o mesmo):
  //   interna  http://cnpj_lookup:8082                  sem chave
  //   pela borda comercial  https://gateway.maxgateway.com.br  com CNPJ_LOOKUP_API_KEY (chave `mgk_` da organização do Fixer)
  readonly serviceBaseUrl = (process.env.CNPJ_LOOKUP_SERVICE_URL ?? 'http://localhost:8082').replace(/\/+$/, '');

  // Chave de API do cliente na borda comercial da plataforma. Vazia = chamada direta, sem cabeçalho. Nunca vai a log.
  readonly apiKey: string | undefined = process.env.CNPJ_LOOKUP_API_KEY?.trim() || undefined;

  readonly timeoutMs = Number(process.env.CNPJ_LOOKUP_SERVICE_TIMEOUT_MS ?? 20_000);
}
