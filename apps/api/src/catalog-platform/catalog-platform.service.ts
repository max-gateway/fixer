import { createCatalogClient, unwrap, type paths } from '@max-gateway/catalog-client';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { countsAsPlatformFailure, retryDecision, toHttpException } from './platform-error.js';
import { PartsSearchConfig, type PartsSearchSettings } from './parts-search.config.js';
import { Bulkhead } from './resilience/bulkhead.js';
import { BreakerRegistry } from './resilience/circuit-breaker.js';
import { withRetry } from './resilience/retry.js';

/**
 * A loja da oficina na plataforma: o Fixer não tem lojas e registra uma por organização com o PRÓPRIO id da organização (`FixerTenantDirectory.storesOf`),
 * em minúsculas. As rotas fiscais levam a loja no caminho (`/v1/stores/{storeId}/...`).
 */
export const storeOf = (caller: Pick<CallerContext, 'orgId' | 'storeId'>): string => (caller.storeId ?? caller.orgId).toLowerCase();

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
export type VehiclePartsQuery = NonNullable<paths['/v1/catalogs/{catalog}/parts']['get']['parameters']['query']>;
export type FiscalObservationItem = NonNullable<paths['/v1/stores/{storeId}/fiscal-observations']['post']['requestBody']>['content']['application/json']['items'][number];
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

  /**
   * Classificação fiscal RESOLVIDA (override da oficina sobre o cadastro global, com o aceite do contador) de até 500 peças do catálogo, no formato `item`
   * do motor tributário. Peça sem classificação volta `INCOMPLETO`; peça que o catálogo não tem volta em `unknown`.
   */
  fiscalResolve(caller: CallerContext, skus: string[]) {
    const storeId = storeOf(caller);
    return this.call(caller, async (client) => unwrap(await client.POST('/v1/stores/{storeId}/fiscal:resolve', { params: { path: { storeId } }, body: { skus } })));
  }

  /**
   * Evidência fiscal das notas de entrada (o que o fornecedor escreveu para a peça). Idempotente por (nota, peça), então repetir é seguro. Nunca altera a
   * classificação em vigor: só alimenta o consenso do catálogo. A chave de acesso e o CNPJ do emitente vão em claro por TLS e a plataforma só guarda hash.
   */
  fiscalObservations(caller: CallerContext, items: FiscalObservationItem[], idempotencyKey: string) {
    const storeId = storeOf(caller);
    return this.call(caller, async (client) =>
      unwrap(await client.POST('/v1/stores/{storeId}/fiscal-observations', { params: { path: { storeId }, header: { 'Idempotency-Key': idempotencyKey } }, body: { items } })),
    );
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
