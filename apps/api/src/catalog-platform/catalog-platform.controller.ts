import { Body, Controller, ForbiddenException, Get, HttpCode, Param, NotFoundException, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { CatalogPlatformService, type CallerContext } from './catalog-platform.service.js';

export interface PlatformRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Contexto resolvido pelo `TenantMiddleware` (`@max-gateway/auth`). */
  principal?: { tenantId?: string; storeId?: string; catalogs?: string[] };
}

const header = (req: PlatformRequest, name: string): string | undefined => {
  const raw = req.headers[name];
  return (Array.isArray(raw) ? raw[0] : raw) || undefined;
};

/**
 * Quem chama a plataforma: o token do PRÓPRIO usuário (propagado, nunca reemitido), a organização que o `TenantMiddleware` resolveu e o traceparent da
 * requisição de origem. Sem Bearer ou sem Principal, a rota nunca fala com a plataforma.
 *
 * A LOJA não vai: o Fixer não tem lojas, e a loja que a plataforma conhece (em produção, "principal") não é o id da organização; um `X-Store-Id` que
 * ela não reconhece dá 404 em qualquer rota. Sem o cabeçalho, vale a única loja da organização. A busca e a consulta em lote são do catálogo, não da loja.
 */
export function callerFrom(req: PlatformRequest): CallerContext {
  const [scheme, token] = (header(req, 'authorization') ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || !req.principal?.tenantId) throw new UnauthorizedException('Token ausente');
  const traceparent = header(req, 'traceparent');
  return {
    token,
    orgId: req.principal.tenantId,
    ...(traceparent ? { traceparent } : {}),
  };
}

/** Catálogo da chamada: o pedido explícito precisa ser um dos que a pessoa lê (senão 404, idêntico a inexistente); sem pedido, o primeiro. */
export function pickCatalog(req: PlatformRequest, wanted: string | undefined): string {
  const catalogs = req.principal?.catalogs ?? [];
  if (catalogs.length === 0) throw new ForbiddenException('Sua oficina não tem catálogo de peças configurado');
  if (wanted === undefined) return catalogs[0]!;
  if (!catalogs.includes(wanted)) throw new NotFoundException('Não encontrado');
  return wanted;
}

const LOOKUP_MAX = 100;
const list = z.union([z.string().min(1).max(64), z.array(z.string().min(1).max(64))]).transform((v) => (Array.isArray(v) ? v : [v]));
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const catalogName = z.string().min(1).max(64);

/** A loja NÃO é parâmetro: vem do Principal. Parâmetro que o Fixer não conhece é 400, nunca repassado. */
const SearchParams = z
  .object({
    q: z.string().trim().min(1).max(200),
    page: int(1, 300).optional(),
    limit: int(1, 50).optional(),
    sort: z.enum(['relevance', 'price_asc', 'price_desc']).optional(),
    brandKey: list.optional(),
    categoryId: list.optional(),
    categoryPathIn: list.optional(),
    categoryPathNotIn: list.optional(),
    priceMin: z.coerce.number().min(0).optional(),
    priceMax: z.coerce.number().min(0).optional(),
    vehicleId: z.string().min(1).max(64).optional(),
    catalog: catalogName.optional(),
  })
  .strict();

const VehiclePartsParams = z
  .object({
    vehicleId: z.string().min(1).max(64).optional(),
    make: z.string().trim().min(1).max(100).optional(),
    model: z.string().trim().min(1).max(100).optional(),
    categoryPathIn: list.optional(),
    categoryPathNotIn: list.optional(),
    page: int(1, 300).optional(),
    limit: int(1, 50).optional(),
    catalog: catalogName.optional(),
  })
  .strict()
  .refine((v) => v.vehicleId || v.make || v.model, { message: 'Informe vehicleId, make ou model' });
const SkuParam = z.string().min(1).max(64);
const OneCatalog = z.object({ catalog: catalogName.optional() }).strict();
const AutocompleteParams = z.object({ q: z.string().trim().min(1).max(200), limit: int(1, 50).optional(), vehicleId: z.string().min(1).max(64).optional(), catalog: catalogName.optional() }).strict();
const SkuLookup = z.object({ skus: z.array(z.string().min(1).max(64)).min(1).max(LOOKUP_MAX), catalog: catalogName.optional() }).strict();
const BarcodeLookup = z.object({ barcodes: z.array(z.string().regex(/^[0-9]{8,14}$/)).min(1).max(LOOKUP_MAX), catalog: catalogName.optional() }).strict();

/**
 * Peças do catálogo global da plataforma (parts-search) para a oficina: busca, autocomplete e consulta em lote por sku e por GTIN. Só leitura. Qualquer pessoa
 * da oficina consulta (não há permissão de negócio própria): quem decide o que ela vê é o token dela na plataforma.
 */
@Controller('catalog')
export class CatalogPlatformController {
  constructor(private readonly platform: CatalogPlatformService) {}

  @Get('parts/search')
  async search(@Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog, ...params } = parse(SearchParams, query);
    return this.platform.search(callerFrom(req), pickCatalog(req, catalog), params);
  }

  @Get('parts/autocomplete')
  async autocomplete(@Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog, ...params } = parse(AutocompleteParams, query);
    return this.platform.autocomplete(callerFrom(req), pickCatalog(req, catalog), params);
  }

  /** Peças que servem a um veículo (ou família make/model). Declarada antes de `parts/:sku` para não ser engolida por ele. */
  @Get('vehicle-parts')
  async vehicleParts(@Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog, ...params } = parse(VehiclePartsParams, query);
    return this.platform.vehicleParts(callerFrom(req), pickCatalog(req, catalog), params);
  }

  @Get('parts/:sku/fits/:vehicleId')
  async fits(@Param('sku') sku: string, @Param('vehicleId') vehicleId: string, @Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog } = parse(OneCatalog, query);
    return this.platform.fits(callerFrom(req), pickCatalog(req, catalog), parse(SkuParam, sku), parse(SkuParam, vehicleId));
  }

  /**
   * Classificação fiscal RESOLVIDA da peça para a oficina (override dela sobre o cadastro global). É dado privado da oficina, então exige `pricing.read`.
   * Peça que o catálogo não tem volta `fiscal: null`; peça sem classificação volta com `fiscalStatus: INCOMPLETO`.
   */
  @Get('parts/:sku/fiscal')
  @RequirePermission('pricing.read')
  async fiscal(@Param('sku') sku: string, @Req() req: PlatformRequest) {
    const { items } = await this.platform.fiscalResolve(callerFrom(req), [parse(SkuParam, sku)]);
    return { fiscal: items[0] ?? null };
  }

  @Get('parts/:sku')
  async part(@Param('sku') sku: string, @Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog } = parse(OneCatalog, query);
    return this.platform.part(callerFrom(req), pickCatalog(req, catalog), parse(SkuParam, sku));
  }

  @Post('parts/lookup')
  @HttpCode(200)
  async lookupParts(@Body() body: unknown, @Req() req: PlatformRequest) {
    const { catalog, skus } = parse(SkuLookup, body);
    return this.platform.lookupParts(callerFrom(req), pickCatalog(req, catalog), [...new Set(skus)]);
  }

  @Post('barcodes/lookup')
  @HttpCode(200)
  async lookupBarcodes(@Body() body: unknown, @Req() req: PlatformRequest) {
    const { catalog, barcodes } = parse(BarcodeLookup, body);
    return this.platform.lookupBarcodes(callerFrom(req), pickCatalog(req, catalog), [...new Set(barcodes)]);
  }
}
