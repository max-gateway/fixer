import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/parse.js';
import { InvalidPlateError, PlateLookupService } from '../plate-lookup/plate-lookup.service.js';
import { callerFrom, pickCatalog, type PlatformRequest } from './catalog-platform.controller.js';
import { CatalogPlatformService } from './catalog-platform.service.js';
import { plateQueries, plateVehicle } from './plate-vehicle.js';

const catalogName = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(100);
const FacetsParams = z
  .object({ make: name.optional(), model: name.optional(), year: z.coerce.number().int().min(1900).max(2100).optional(), catalog: catalogName.optional() })
  .strict()
  .refine((v) => !v.model || v.make, { message: 'Informe a montadora antes do modelo' })
  .refine((v) => v.year === undefined || v.model, { message: 'Informe montadora e modelo antes do ano' });
const ResolveParams = z.object({ q: z.string().trim().min(2).max(120), limit: z.coerce.number().int().min(1).max(50).optional(), catalog: catalogName.optional() }).strict();
const OneCatalog = z.object({ catalog: catalogName.optional() }).strict();
const VehicleId = z.string().min(1).max(64);
const PLATE_CANDIDATES = 8;

/**
 * Escolha do veículo para a busca de peças: o diretório de veículos da plataforma (os mesmos ids que a busca aceita em `vehicleId`) e a placa, que é
 * do Fixer (consulta paga, guardada para sempre por placa) e vira consulta ao diretório. Só leitura; qualquer pessoa da oficina consulta.
 */
@Controller('catalog/vehicles')
export class VehicleDirectoryController {
  constructor(
    private readonly platform: CatalogPlatformService,
    private readonly plates: PlateLookupService,
  ) {}

  /** Cascata montadora → modelo → ano → veículo. */
  @Get()
  async facets(@Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog, ...sel } = parse(FacetsParams, query);
    return this.platform.vehicleFacets(callerFrom(req), pickCatalog(req, catalog), sel);
  }

  /** Texto livre ("gol 1.6 2015") → veículos candidatos. */
  @Get('resolve')
  async resolve(@Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog, q, limit } = parse(ResolveParams, query);
    return this.platform.resolveVehicles(callerFrom(req), pickCatalog(req, catalog), q, limit);
  }

  /**
   * Placa → o que ela diz do carro e os veículos do catálogo que casam, da consulta mais específica à mais solta. A placa já consultada não gera
   * nova cobrança. `candidates` vazio com `vehicle` preenchido: a placa existe, mas o catálogo não tem o modelo (a tela oferece a escolha manual).
   */
  @Get('plate/:placa')
  async byPlate(@Param('placa') placa: string, @Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog } = parse(OneCatalog, query);
    const caller = callerFrom(req);
    const target = pickCatalog(req, catalog);
    let record;
    try {
      record = await this.plates.lookup(placa);
    } catch (err) {
      if (err instanceof InvalidPlateError) throw new BadRequestException('Placa inválida. Use o formato ABC1234 ou ABC1D23.');
      throw err;
    }
    const vehicle = plateVehicle(record.result);
    if (!vehicle) return { plate: record.plate, vehicle: null, candidates: [] };
    for (const q of plateQueries(vehicle)) {
      const { data } = await this.platform.resolveVehicles(caller, target, q, PLATE_CANDIDATES);
      if (data.length > 0) return { plate: record.plate, vehicle, candidates: data };
    }
    return { plate: record.plate, vehicle, candidates: [] };
  }

  /** Um veículo do diretório (reabrir o que veio no link ou na ordem de serviço). Declarada por último para não engolir `resolve`. */
  @Get(':vehicleId')
  async one(@Param('vehicleId') vehicleId: string, @Query() query: unknown, @Req() req: PlatformRequest) {
    const { catalog } = parse(OneCatalog, query);
    return this.platform.vehicle(callerFrom(req), pickCatalog(req, catalog), parse(VehicleId, vehicleId));
  }
}
