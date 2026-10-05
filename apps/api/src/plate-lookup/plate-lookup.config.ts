import { Injectable } from '@nestjs/common';

@Injectable()
export class PlateLookupConfig {
  // Base URL do microservice apps/plate-lookup (Python), não da Puxa Placa
  // diretamente — o core nunca fala com a Puxa Placa, só com o microservice.
  readonly serviceBaseUrl =
    process.env.PLATE_LOOKUP_SERVICE_URL ?? 'http://localhost:8081';

  readonly timeoutMs = Number(process.env.PLATE_LOOKUP_SERVICE_TIMEOUT_MS ?? 15_000);
}
