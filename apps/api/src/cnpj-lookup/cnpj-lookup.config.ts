import { Injectable } from '@nestjs/common';

@Injectable()
export class CnpjLookupConfig {
  // Base URL do microservice apps/cnpj-lookup (Python), não do CNPJá diretamente —
  // o core nunca fala com o CNPJá nem guarda a chave dele.
  readonly serviceBaseUrl =
    process.env.CNPJ_LOOKUP_SERVICE_URL ?? 'http://localhost:8082';

  readonly timeoutMs = Number(process.env.CNPJ_LOOKUP_SERVICE_TIMEOUT_MS ?? 20_000);
}
