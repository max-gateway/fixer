import { createCatalogClient, unwrap, type paths } from '@max-gateway/catalog-client';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { countsAsPlatformFailure, retryDecision, toHttpException } from './platform-error.js';
import { PartsSearchConfig, type PartsSearchSettings } from './parts-search.config.js';
import { Bulkhead } from './resilience/bulkhead.js';
import { BreakerRegistry } from './resilience/circuit-breaker.js';
import { withRetry } from './resilience/retry.js';

/** Token de injeção do `fetch` (só os testes o trocam). */
export const PARTS_SEARCH_FETCH = Symbol('PARTS_SEARCH_FETCH');

/** Quem está chamando: a pessoa (token propagado, nunca reemitido), a organização, a loja se já escolhida e o traceparent da requisição de origem. */
export interface CallerContext {
  token: string;
  orgId: string;
  storeId?: string;
  traceparent?: string;
}

export type SearchQuery = NonNullable<paths['/v1/catalogs/{catalog}/search']['get']['parameters']['query']>;
export type VehiclePartsQuery = NonNullable<paths['/v1/catalogs/{catalog}/parts']['get']['parameters']['query']>;
export type FiscalObservationItem = NonNullable<paths['/v1/fiscal-observations']['post']['requestBody']>['content']['application/json']['items'][number];
export type VehicleFacetsQuery = NonNullable<paths['/v1/catalogs/{catalog}/vehicles']['get']['parameters']['query']>;
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

  /** Peças de um veículo (ou família make/model) e universais, em ordem estável. */
  vehicleParts(caller: CallerContext, catalog: string, query: VehiclePartsQuery) {
    return this.call(caller, async (client) => unwrap(await client.GET('/v1/catalogs/{catalog}/parts', { params: { path: { catalog }, query } })));
  }

  /** Cadastro completo da peça (aplicações, cross-references, atributos, códigos OEM). */
  part(caller: CallerContext, catalog: string, sku: string) {
    return this.call(caller, async (client) => unwrap(await client.GET('/v1/catalogs/{catalog}/parts/{sku}', { params: { path: { catalog, sku } } })));
  }

  /** A peça serve neste veículo? */
  fits(caller: CallerContext, catalog: string, sku: string, vehicleId: string) {
    return this.call(caller, async (client) => unwrap(await client.GET('/v1/catalogs/{catalog}/parts/{sku}/fits/{vehicleId}', { params: { path: { catalog, sku, vehicleId } } })));
  }

  /** Resumo de até 100 peças por sku; o que não existe no catálogo volta em `missing`. */
  lookupParts(caller: CallerContext, catalog: string, skus: string[]) {
    return this.call(caller, async (client) => unwrap(await client.POST('/v1/catalogs/{catalog}/parts:lookup', { params: { path: { catalog } }, body: { skus } })));
  }

  /** Skus ativos por GTIN (até 100). */
  lookupBarcodes(caller: CallerContext, catalog: string, barcodes: string[]) {
    return this.call(caller, async (client) => unwrap(await client.POST('/v1/catalogs/{catalog}/barcodes:lookup', { params: { path: { catalog } }, body: { barcodes } })));
  }

  /** Diretório de veículos em cascata (montadora → modelo → ano → veículo), com os mesmos ids que a busca aceita em `vehicleId`. */
  vehicleFacets(caller: CallerContext, catalog: string, query: VehicleFacetsQuery) {
    return this.call(caller, async (client) => unwrap(await client.GET('/v1/catalogs/{catalog}/vehicles', { params: { path: { catalog }, query } })));
  }

  /** Texto livre ("gol 1.6 2015") → veículos candidatos, do mais provável ao menos. */
  resolveVehicles(caller: CallerContext, catalog: string, q: string, limit?: number) {
    return this.call(caller, async (client) => unwrap(await client.GET('/v1/catalogs/{catalog}/vehicles:resolve', { params: { path: { catalog }, query: { q, ...(limit ? { limit } : {}) } } })));
  }

  /** Um veículo do diretório (para reabrir o que já foi escolhido). */
  vehicle(caller: CallerContext, catalog: string, vehicleId: string) {
    return this.call(caller, async (client) => unwrap(await client.GET('/v1/catalogs/{catalog}/vehicles/{vehicleId}', { params: { path: { catalog, vehicleId } } })));
  }

  /**
   * Classificação fiscal RESOLVIDA (override da oficina sobre o cadastro global, com o aceite do contador) de até 500 peças do catálogo, no formato `item`
   * do motor tributário. É da ORGANIZAÇÃO, não de uma loja (ADR-10 da plataforma). Peça sem classificação volta `INCOMPLETO`; peça que o catálogo não tem
   * volta em `unknown`.
   */
  fiscalResolve(caller: CallerContext, skus: string[]) {
    return this.call(caller, async (client) => unwrap(await client.POST('/v1/fiscal:resolve', { body: { skus } })));
  }

  /**
   * Evidência fiscal das notas de entrada (o que o fornecedor escreveu para a peça). Idempotente por (nota, peça), então repetir é seguro. Nunca altera a
   * classificação em vigor: só alimenta o consenso do catálogo. A chave de acesso e o CNPJ do emitente vão em claro por TLS e a plataforma só guarda hash.
   */
  fiscalObservations(caller: CallerContext, items: FiscalObservationItem[], idempotencyKey: string) {
    return this.call(caller, async (client) => unwrap(await client.POST('/v1/fiscal-observations', { params: { header: { 'Idempotency-Key': idempotencyKey } }, body: { items } })));
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
