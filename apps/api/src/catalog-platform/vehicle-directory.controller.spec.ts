import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidPlateError } from '../plate-lookup/plate-lookup.service.js';
import { plateQueries, plateVehicle } from './plate-vehicle.js';
import { VehicleDirectoryController } from './vehicle-directory.controller.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CATALOG = 'rocket-autopecas';
const CALLER = { token: 'user-jwt', orgId: ORG };
const request = () => ({ headers: { authorization: 'Bearer user-jwt' }, principal: { tenantId: ORG, catalogs: [CATALOG] } }) as never;

const golPlate = { basico: { error: false, dados: { marca: 'VW', modelo: 'GOL 1.6 MSI', marcamodelo: 'VW/GOL 1.6 MSI', cilindradas: 1598, combustivel: 'Alcool/Gasolina', anoModelo: 2015, ano: 2014 } } };

describe('plateVehicle / plateQueries (placa → consulta ao diretório)', () => {
  it('normaliza montadora e modelo como as variantes da oficina, motor pela cilindrada e o ano-modelo', () => {
    expect(plateVehicle(golPlate as never)).toEqual({ label: 'VW/GOL 1.6 MSI', make: 'vw', model: 'gol', engine: '1.6', year: 2015 });
  });

  it('sem marca na placa não há o que procurar', () => {
    expect(plateVehicle({ basico: { error: true, dados: null } } as never)).toBeNull();
  });

  it('da consulta mais específica à mais solta, sem repetir; montadora e motor caem antes do modelo', () => {
    expect(plateQueries({ label: '', make: 'vw', model: 'gol', engine: '1.6', year: 2015 })).toEqual(['vw gol 1.6 2015', 'vw gol 2015', 'gol 1.6 2015', 'gol 2015', 'vw gol', 'gol']);
    expect(plateQueries({ label: '', make: 'fiat', model: 'uno' })).toEqual(['fiat uno', 'uno']);
    expect(plateQueries({ label: '', make: 'fiat' })).toEqual(['fiat']);
  });
});

describe('VehicleDirectoryController', () => {
  const platform = { vehicleFacets: vi.fn(), resolveVehicles: vi.fn(), vehicle: vi.fn() };
  const plates = { lookup: vi.fn() };
  const controller = new VehicleDirectoryController(platform as never, plates as never);

  beforeEach(() => {
    for (const fn of [...Object.values(platform), plates.lookup]) fn.mockReset();
  });

  it('cascata: repassa montadora, modelo e ano ao diretório do catálogo da pessoa', async () => {
    platform.vehicleFacets.mockResolvedValue({ makes: [] });
    await controller.facets({ make: 'Fiat', model: 'Strada', year: '2016' }, request());
    expect(platform.vehicleFacets).toHaveBeenCalledWith(CALLER, CATALOG, { make: 'Fiat', model: 'Strada', year: 2016 });
  });

  it('cascata fora de ordem ou parâmetro desconhecido é 400, sem falar com a plataforma', async () => {
    await expect(controller.facets({ model: 'Strada' }, request())).rejects.toThrow(BadRequestException);
    await expect(controller.facets({ make: 'Fiat', year: '2016' }, request())).rejects.toThrow(BadRequestException);
    await expect(controller.facets({ cor: 'azul' }, request())).rejects.toThrow(BadRequestException);
    expect(platform.vehicleFacets).not.toHaveBeenCalled();
  });

  it('texto livre: repassa q e o limite', async () => {
    platform.resolveVehicles.mockResolvedValue({ data: [] });
    await controller.resolve({ q: 'gol 1.6', limit: '5' }, request());
    expect(platform.resolveVehicles).toHaveBeenCalledWith(CALLER, CATALOG, 'gol 1.6', 5);
  });

  it('placa: tenta da consulta mais específica à mais solta e para na primeira com candidato', async () => {
    plates.lookup.mockResolvedValue({ plate: 'ABC1D23', cached: true, result: golPlate });
    platform.resolveVehicles.mockImplementation(async (_c: unknown, _cat: unknown, q: string) => ({ data: q === 'gol 1.6 2015' ? [{ vehicleId: 'v-gol16' }] : [] }));
    const out = await controller.byPlate('abc-1d23', {}, request());
    expect(out).toEqual({ plate: 'ABC1D23', vehicle: { label: 'VW/GOL 1.6 MSI', make: 'vw', model: 'gol', engine: '1.6', year: 2015 }, candidates: [{ vehicleId: 'v-gol16' }] });
    expect(platform.resolveVehicles.mock.calls.map((c) => c[2])).toEqual(['vw gol 1.6 2015', 'vw gol 2015', 'gol 1.6 2015']);
  });

  it('placa que o catálogo não tem: devolve o que a placa diz e nenhum candidato', async () => {
    plates.lookup.mockResolvedValue({ plate: 'ABC1D23', cached: false, result: golPlate });
    platform.resolveVehicles.mockResolvedValue({ data: [] });
    expect(await controller.byPlate('ABC1D23', {}, request())).toMatchObject({ vehicle: { model: 'gol' }, candidates: [] });
  });

  it('placa em formato inválido é 400 com mensagem para a pessoa', async () => {
    plates.lookup.mockRejectedValue(new InvalidPlateError('12'));
    await expect(controller.byPlate('12', {}, request())).rejects.toThrow(BadRequestException);
  });

  it('um veículo: erro da plataforma (404) sobe como veio', async () => {
    platform.vehicle.mockRejectedValue(new NotFoundException());
    await expect(controller.one('v-x', {}, request())).rejects.toThrow(NotFoundException);
    expect(platform.vehicle).toHaveBeenCalledWith(CALLER, CATALOG, 'v-x');
  });
});
