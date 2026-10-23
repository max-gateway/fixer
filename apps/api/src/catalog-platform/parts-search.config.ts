import { Injectable } from '@nestjs/common';

/** Tudo que o `CatalogPlatformService` precisa saber da plataforma e da política de chamada. Os testes montam um objeto desta forma. */
export interface PartsSearchSettings {
  /** URL da borda da plataforma (nunca o loopback do serviço). */
  baseUrl: string;
  timeoutMs: number;
  /** Repetições além da primeira chamada (só para o que `retryDecision` aceita). */
  retries: number;
  retryBaseMs: number;
  retryMaxMs: number;
  /** Falhas consecutivas da plataforma, por organização, que abrem o disjuntor. */
  breakerThreshold: number;
  breakerOpenMs: number;
  /** Chamadas simultâneas à plataforma; acima disso a chamada é recusada na hora (503), sem fila. */
  maxConcurrent: number;
  maxQueue: number;
}

/**
 * Configuração da integração com a plataforma de catálogo. `PARTS_SEARCH_URL` e `PARTS_SEARCH_TIMEOUT_MS` vêm do ambiente e são validados no boot
 * (`config/env.ts`: a API não sobe sem a URL). O restante é política de chamada, com os valores de docs/specs/parts-search-integration.md §8.
 */
@Injectable()
export class PartsSearchConfig implements PartsSearchSettings {
  readonly baseUrl = process.env.PARTS_SEARCH_URL ?? '';
  readonly timeoutMs = Number(process.env.PARTS_SEARCH_TIMEOUT_MS ?? 2000);
  readonly retries = 2;
  readonly retryBaseMs = 100;
  readonly retryMaxMs = 1000;
  readonly breakerThreshold = 5;
  readonly breakerOpenMs = 15_000;
  readonly maxConcurrent = 16;
  readonly maxQueue = 0;
}
