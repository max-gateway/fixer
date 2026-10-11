import { describe, expect, it, vi } from 'vitest';
import { VehicleVariantsService } from './vehicle-variants.service.js';

const palioLookup = {
  basico: { dados: { marca: 'FIAT', modelo: 'PALIO FIRE ECONOMY', cilindradas: 999, combustivel: 'ALCOOL / GASOLINA' } },
  fipe: { dados: [{ codigo_fipe: '001267-0' }] },
};

function setup(lookup: unknown | null) {
  let seq = 0;
  const upserts: Array<{ key: string; create: Record<string, unknown>; update: unknown }> = [];
  const tx = {
    plateLookup: { findUnique: vi.fn().mockResolvedValue(lookup === null ? null : { rawResponse: lookup }) },
    vehicleVariant: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        upserts.push({ key: where.key, create, update });
        return { id: `v${++seq}`, key: where.key };
      }),
    },
    vehicle: { update: vi.fn() },
  };
  return { tx, upserts, service: new VehicleVariantsService() };
}

describe('VehicleVariantsService.resolveForPlate', () => {
  it('garante a cadeia MAKE > MODEL > FAMILY > VERSION e devolve o nó mais específico', async () => {
    const { tx, upserts, service } = setup(palioLookup);
    const r = await service.resolveForPlate(tx as never, 'ABC1D23');
    expect(upserts.map((u) => u.key)).toEqual(['fiat', 'fiat/palio', 'fiat/palio/1.0/flex', 'fipe:001267-0']);
    expect(r).toEqual({ variantId: 'v4', resolution: 'FIPE' });
  });

  it('liga cada nó ao pai criado antes dele e marca os novos como LOCAL', async () => {
    const { upserts, tx, service } = setup(palioLookup);
    await service.resolveForPlate(tx as never, 'ABC1D23');
    expect(upserts[0].create).toMatchObject({ level: 'MAKE', parentId: null, origin: 'LOCAL' });
    expect(upserts[1].create).toMatchObject({ level: 'MODEL', parentId: 'v1', model: 'palio', origin: 'LOCAL' });
    expect(upserts[2].create).toMatchObject({ level: 'FAMILY', parentId: 'v2', engine: '1.0', fuel: 'flex' });
    expect(upserts[3].create).toMatchObject({ level: 'VERSION', parentId: 'v3', fipeCode: '001267-0' });
  });

  it('não altera nós que já existem (update vazio): nem o origin GLOBAL do catálogo', async () => {
    const { upserts, tx, service } = setup(palioLookup);
    await service.resolveForPlate(tx as never, 'ABC1D23');
    for (const u of upserts) expect(u.update).toEqual({});
  });

  it('usa a lista de modelos de várias palavras do catálogo', async () => {
    const { upserts, tx, service } = setup({ basico: { dados: { marca: 'FIAT', modelo: 'GRAND SIENA ATTRACTIVE' } } });
    await service.resolveForPlate(tx as never, 'ABC1D23');
    expect(upserts.map((u) => u.key)).toEqual(['fiat', 'fiat/grand-siena']);
  });

  it('sem consulta salva para a placa resolve NONE sem tocar em variantes', async () => {
    const { tx, upserts, service } = setup(null);
    expect(await service.resolveForPlate(tx as never, 'ABC1D23')).toEqual({ variantId: null, resolution: 'NONE' });
    expect(upserts).toEqual([]);
  });

  it('lookup sem marca resolve NONE', async () => {
    const { tx, service } = setup({ basico: { dados: { modelo: 'PALIO' } } });
    expect(await service.resolveForPlate(tx as never, 'ABC1D23')).toEqual({ variantId: null, resolution: 'NONE' });
  });
});

describe('VehicleVariantsService.attachToVehicle', () => {
  it('grava variantId e variantResolution no veículo', async () => {
    const { tx, service } = setup(palioLookup);
    await service.attachToVehicle(tx as never, 'veh1', 'ABC1D23');
    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: 'veh1' },
      data: { variantId: 'v4', variantResolution: 'FIPE' },
    });
  });

  it('devolve a variante resolvida para quem chamou', async () => {
    const { tx, service } = setup(palioLookup);
    expect(await service.attachToVehicle(tx as never, 'veh1', 'ABC1D23')).toEqual({ variantId: 'v4', resolution: 'FIPE' });
  });

  it('sem lookup não mexe no veículo (não apaga uma variante já resolvida) e devolve null', async () => {
    const { tx, service } = setup(null);
    expect(await service.attachToVehicle(tx as never, 'veh1', 'ABC1D23')).toBeNull();
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });
});
