import { createCatalogClient, unwrap, type paths } from '@max-gateway/catalog-client';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { countsAsPlatformFailure, retryDecision, toHttpException } from './platform-error.js';
import { PartsSearchConfig, type PartsSearchSettings } from './parts-search.config.js';
import { Bulkhead } from './resilience/bulkhead.js';
import { BreakerRegistry } from './resilience/circuit-breaker.js';
import { withRetry } from './resilience/retry.js';

/** Token de injeção do `fetch` (só os testes o trocam). */
export const PARTS_SEARCH_FETCH = Symbol('PARTS_SEARCH_FETCH');

/** Quem está chamando: a pessoa (token propagado, nunca reemitido), a organização e a loja dela e o traceparent da requisição de origem. */
export interface CallerContext {
  token: string;
  orgId: string;
  storeId?: string;
  traceparent?: string;
}

export type SearchQuery = NonNullable<paths['/v1/catalogs/{catalog}/search']['get']['parameters']['query']>;
export type AutocompleteQuery = NonNullable<paths['/v1/catalogs/{catalog}/autocomplete']['get']['parameters']['query']>;

/**
 * Único ponto do Fixer que fala com a plataforma de catálogo (docs/specs/parts-search-integration.md §8). Cada chamada: bulkhead (não esgotar o pool da API)
 * → repetição com backoff e jitter só do que é transitório (leituras, inclusive os POST de consulta, que são idempotentes) → disjuntor por organização
 * (a falha de uma oficina não derruba as outras) → `@max-gateway/catalog-client`, que leva o token do usuário, a organização, a loja e o traceparent.
 * Tudo o que sai daqui para o usuário passa por `toHttpException`: a mensagem da plataforma nunca chega a ele.
 */
@Injectable()
export class CatalogPlatformService {
  private readonly breakers: BreakerRegistry;
  private readonly bulkhead: Bulkhead;

  constructor(
    @Inject(PartsSearchConfig) private readonly settings: PartsSearchSettings,
    @Optional() @Inject(PARTS_SEARCH_FETCH) private readonly fetchImpl?: typeof globalThis.fetch,
  ) {
    this.breakers = new BreakerRegistry({ failureThreshold: settings.breakerThreshold, openMs: settings.breakerOpenMs, isFailure: countsAsPlatformFailure });
    this.bulkhead = new Bulkhead({ maxConcurrent: settings.maxConcurrent, maxQueue: settings.maxQueue });
  }

  search(caller: CallerContext, catalog: string, query: SearchQuery) {
    return this.call(caller, async (client) => unwrap(await client.GET('/v1/catalogs/{catalog}/search', { params: { path: { catalog }, query } })));
  }

  autocomplete(caller: CallerContext, catalog: string, query: AutocompleteQuery) {
    return this.call(caller, async (client) => unwrap(await client.GET('/v1/catalogs/{catalog}/autocomplete', { params: { path: { catalog }, query } })));
  }

  /** Resumo de até 100 peças por sku; o que não existe no catálogo volta em `missing`. */
  lookupParts(caller: CallerContext, catalog: string, skus: string[]) {
    return this.call(caller, async (client) => unwrap(await client.POST('/v1/catalogs/{catalog}/parts:lookup', { params: { path: { catalog } }, body: { skus } })));
  }

  /** Skus ativos por GTIN (até 100). */
  lookupBarcodes(caller: CallerContext, catalog: string, barcodes: string[]) {
    return this.call(caller, async (client) => unwrap(await client.POST('/v1/catalogs/{catalog}/barcodes:lookup', { params: { path: { catalog } }, body: { barcodes } })));
  }

  private async call<T>(caller: CallerContext, op: (client: ReturnType<typeof createCatalogClient>) => Promise<T>): Promise<T> {
    const client = createCatalogClient({
      baseUrl: this.settings.baseUrl,
      context: () => caller,
      timeoutMs: this.settings.timeoutMs,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });
    const breaker = this.breakers.for(caller.orgId);
    try {
      return await this.bulkhead.exec(() =>
        withRetry(() => breaker.exec(() => op(client)), {
          retries: this.settings.retries,
          baseMs: this.settings.retryBaseMs,
          maxMs: this.settings.retryMaxMs,
          isRetryable: retryDecision,
        }),
      );
    } catch (err) {
      throw toHttpException(err);
    }
  }
}
