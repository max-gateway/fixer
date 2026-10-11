import { describe, expect, it, vi } from 'vitest';
import { LearningController } from './learning.controller.js';

function setup(over: { service?: object | null; vehicle?: object | null } = {}) {
  const prisma = {
    service: { findUnique: vi.fn().mockResolvedValue(over.service === undefined ? { definitionId: 'def1' } : over.service) },
    vehicle: { findUnique: vi.fn().mockResolvedValue(over.vehicle === undefined ? { variantId: 'ver1' } : over.vehicle) },
  };
  const learning = { estimate: vi.fn().mockResolvedValue({ source: 'LEARNED', hours: 4 }) };
  return { prisma, learning, controller: new LearningController(learning as never, prisma as never) };
}

describe('LearningController.estimate', () => {
  it('resolve a variante a partir do veículo informado', async () => {
    const { controller, prisma, learning } = setup();
    await controller.estimate('s1', 'veh1');
    expect(prisma.vehicle.findUnique).toHaveBeenCalledWith({ where: { id: 'veh1' }, select: { variantId: true } });
    expect(learning.estimate).toHaveBeenCalledWith('def1', 'ver1');
  });

  it('sem vehicleId consulta com variante nula (NONE)', async () => {
    const { controller, prisma, learning } = setup();
    await controller.estimate('s1');
    expect(prisma.vehicle.findUnique).not.toHaveBeenCalled();
    expect(learning.estimate).toHaveBeenCalledWith('def1', null);
  });

  it('veículo inexistente ou sem variante resolvida: variante nula', async () => {
    const { controller, learning } = setup({ vehicle: null });
    await controller.estimate('s1', 'nope');
    expect(learning.estimate).toHaveBeenCalledWith('def1', null);
  });

  it('serviço avulso (sem definição) ou inexistente: NONE sem consultar o aprendizado', async () => {
    for (const service of [null, { definitionId: null }]) {
      const { controller, learning } = setup({ service });
      expect(await controller.estimate('s1', 'veh1')).toEqual({ source: 'NONE' });
      expect(learning.estimate).not.toHaveBeenCalled();
    }
  });
});
