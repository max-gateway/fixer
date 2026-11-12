import { Injectable } from '@nestjs/common';

/** Tudo que o `WorkforceService` precisa saber do serviço workforce da plataforma. Os testes montam um objeto desta forma. */
export interface WorkforceSettings {
  /** Borda do serviço (nunca o loopback). Vazio = não configurado: as rotas respondem 503, o resto da API segue de pé. */
  baseUrl: string;
  timeoutMs: number;
}

@Injectable()
export class WorkforceConfig implements WorkforceSettings {
  readonly baseUrl = (process.env.WORKFORCE_URL ?? '').replace(/\/+$/, '');
  readonly timeoutMs = Number(process.env.WORKFORCE_TIMEOUT_MS ?? 3000);
}
