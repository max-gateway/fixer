import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AddServiceLineSchema } from './schema.js';
import { ServiceOrdersService } from './service-orders.service.js';

const learned = { source: 'LEARNED', hours: 4.5, p25: 4, p75: 5, level: 'MODEL', sampleCount: 6 };

function setup(over: { order?: object | null; service?: object | null; estimate?: unknown } = {}) {
  const order =
    over.order === undefined
      ? { id: 'o1', status: 'APPROVED', vehicle: { variantId: 'ver1', variantResolution: 'FIPE' } }
      : over.order;
  const service =
    over.service === undefined
      ? { id: 's1', name: 'Troca de embreagem', defaultPrice: 500, pricingMode: 'FIXED', definitionId: 'def1' }
      : over.service;
  const tx = {
    serviceOrder: { findUnique: vi.fn().mockResolvedValue(order) },
    service: { findMany: vi.fn().mockResolvedValue(service ? [service] : []) },
    tenantFiscalSettings: { findUnique: vi.fn().mockResolvedValue({ hourlyRate: 100 }) },
    serviceOrderServiceLine: {
      create: vi.fn().mockImplementation(async ({ data }: { data: object }) => ({ id: 'sl1', ...data })),
    },
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const learning = { estimateFor: vi.fn().mockResolvedValue(over.estimate ?? learned), recordForOrder: vi.fn() };
  return { tx, learning, service: new ServiceOrdersService(prisma as never, {} as never, learning as never) };
}

describe('AddServiceLineSchema', () => {
  it('exige o serviço e aceita preço, texto livre e horas opcionais', () => {
    expect(AddServiceLineSchema.safeParse({ serviceId: 's1' }).success).toBe(true);
    expect(AddServiceLineSchema.safeParse({ serviceId: 's1', price: 300, description: 'x', hours: 4 }).success).toBe(true);
    expect(AddServiceLineSchema.safeParse({}).success).toBe(false);
    expect(AddServiceLineSchema.safeParse({ serviceId: 's1', hours: 0 }).success).toBe(false);
  });
});

describe('ServiceOrdersService.addServiceLine', () => {
  it('cria a linha com o snapshot da variante do veículo e da estimativa', async () => {
    const { service, tx, learning } = setup();
    await service.addServiceLine('o1', { serviceId: 's1' });
    expect(learning.estimateFor).toHaveBeenCalledWith(tx, 'def1', 'ver1');
    expect(tx.serviceOrderServiceLine.create.mock.calls[0][0].data).toMatchObject({
      serviceOrderId: 'o1',
      serviceId: 's1',
      serviceName: 'Troca de embreagem',
      price: 500,
      variantId: 'ver1',
      variantResolution: 'FIPE',
      hoursEstimated: 4.5,
      hoursEstimateSource: 'LEARNED',
    });
  });

  it('horas informadas viram MANUAL e prevalecem sobre a estimativa', async () => {
    const { service, tx } = setup();
    await service.addServiceLine('o1', { serviceId: 's1', hours: 7, description: 'com volante' });
    expect(tx.serviceOrderServiceLine.create.mock.calls[0][0].data).toMatchObject({
      hoursEstimated: 7,
      hoursEstimateSource: 'MANUAL',
      description: 'com volante',
    });
  });

  it.each(['QUOTE', 'APPROVED', 'IN_PROGRESS', 'AWAITING_PART'])('aceita OS em %s', async (status) => {
    const { service } = setup({ order: { id: 'o1', status, vehicle: { variantId: null, variantResolution: null } } });
    await expect(service.addServiceLine('o1', { serviceId: 's1' })).resolves.toBeDefined();
  });

  it.each(['COMPLETED', 'DELIVERED', 'CANCELLED'])('recusa OS em %s', async (status) => {
    const { service, tx } = setup({ order: { id: 'o1', status, vehicle: { variantId: null, variantResolution: null } } });
    await expect(service.addServiceLine('o1', { serviceId: 's1' })).rejects.toThrow(ConflictException);
    expect(tx.serviceOrderServiceLine.create).not.toHaveBeenCalled();
  });

  it('OS inexistente: 404; serviço inexistente: 400', async () => {
    await expect(setup({ order: null }).service.addServiceLine('x', { serviceId: 's1' })).rejects.toThrow(NotFoundException);
    await expect(setup({ service: null }).service.addServiceLine('o1', { serviceId: 'nope' })).rejects.toThrow(BadRequestException);
  });
});
