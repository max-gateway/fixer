import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ServiceOrdersService } from './service-orders.service.js';

const user = { id: 'u1', keycloakId: 'k', name: 'Ana', email: 'a@x.com' };

describe('ServiceOrdersService.transition — aprendizado de horas', () => {
  const withDef = { id: 'sl1', serviceName: 'Troca de embreagem', hoursActual: null, service: { definitionId: 'def1' } };

  function setup(order: { status: string; serviceLines: unknown[] }) {
    const tx = {
      serviceOrder: {
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', number: 7, partLines: [], ...order }),
        update: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'o1', status: 'COMPLETED' }),
      },
      serviceOrderStatusLog: { create: vi.fn() },
      serviceOrderEvent: { create: vi.fn() },
      outboxEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    const learning = { recordForOrder: vi.fn().mockResolvedValue(undefined), estimateFor: vi.fn() };
    return { tx, learning, service: new ServiceOrdersService(prisma as never, {} as never, learning as never) };
  }

  it('ao concluir, grava as observações da OS na mesma transação', async () => {
    const { service, learning, tx } = setup({ status: 'IN_PROGRESS', serviceLines: [{ ...withDef, hoursActual: 4.5 }] });
    await service.transition('o1', { status: 'COMPLETED' }, user);
    expect(learning.recordForOrder).toHaveBeenCalledWith(tx, 'o1');
  });

  it('em outras transições não grava observações', async () => {
    const { service, learning } = setup({ status: 'APPROVED', serviceLines: [] });
    await service.transition('o1', { status: 'IN_PROGRESS' }, user);
    expect(learning.recordForOrder).not.toHaveBeenCalled();
  });

  it('bloqueia a conclusão quando um serviço do catálogo está sem horas reais', async () => {
    const { service, tx } = setup({ status: 'IN_PROGRESS', serviceLines: [withDef] });
    await expect(service.transition('o1', { status: 'COMPLETED' }, user)).rejects.toThrow(/Troca de embreagem/);
    expect(tx.serviceOrder.update).not.toHaveBeenCalled();
  });

  it('serviço avulso (sem definição) não exige horas para concluir', async () => {
    const { service } = setup({
      status: 'IN_PROGRESS',
      serviceLines: [{ id: 'sl2', serviceName: 'Taxa', hoursActual: null, service: { definitionId: null } }],
    });
    await expect(service.transition('o1', { status: 'COMPLETED' }, user)).resolves.toBeDefined();
  });
});

describe('ServiceOrdersService.recordHours', () => {
  function setup(status: string, line: Record<string, unknown> | null) {
    const tx = {
      serviceOrder: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', status }) },
      serviceOrderServiceLine: {
        findFirst: vi.fn().mockResolvedValue(line),
        update: vi.fn().mockImplementation(async ({ data }: { data: object }) => ({ id: 'sl1', ...data })),
      },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    return { tx, service: new ServiceOrdersService(prisma as never, {} as never, {} as never) };
  }

  it('hora diferente da sugerida: EDITED', async () => {
    const { service, tx } = setup('IN_PROGRESS', { id: 'sl1', hoursEstimated: 4, hoursEstimateSource: 'LEARNED' });
    await service.recordHours('o1', 'sl1', { hours: 5 });
    expect(tx.serviceOrderServiceLine.update).toHaveBeenCalledWith({
      where: { id: 'sl1' },
      data: { hoursActual: 5, hoursActualSource: 'EDITED' },
    });
  });

  it('hora igual à sugerida aprendida: ACCEPTED_DEFAULT (não é medição)', async () => {
    const { service, tx } = setup('IN_PROGRESS', { id: 'sl1', hoursEstimated: 4, hoursEstimateSource: 'LEARNED' });
    await service.recordHours('o1', 'sl1', { hours: 4 });
    expect(tx.serviceOrderServiceLine.update.mock.calls[0][0].data.hoursActualSource).toBe('ACCEPTED_DEFAULT');
  });

  it('igual a uma referência ou a um valor manual conta como EDITED: não havia nada aprendido para aceitar', async () => {
    for (const src of ['REFERENCE', 'MANUAL', 'NONE']) {
      const { service, tx } = setup('IN_PROGRESS', { id: 'sl1', hoursEstimated: 4, hoursEstimateSource: src });
      await service.recordHours('o1', 'sl1', { hours: 4 });
      expect(tx.serviceOrderServiceLine.update.mock.calls[0][0].data.hoursActualSource).toBe('EDITED');
    }
  });

  it('só aceita horas em OS em execução', async () => {
    const { service } = setup('QUOTE', { id: 'sl1' });
    await expect(service.recordHours('o1', 'sl1', { hours: 4 })).rejects.toThrow(ConflictException);
  });

  it('linha de outra OS: 404', async () => {
    const { service } = setup('IN_PROGRESS', null);
    await expect(service.recordHours('o1', 'x', { hours: 4 })).rejects.toThrow(/não encontrad/i);
  });
});

describe('ServiceOrdersService.create — horas nas linhas de serviço', () => {
  const learned = { source: 'LEARNED', hours: 4.5, p25: 4, p75: 5, level: 'MODEL', sampleCount: 6 };

  function setup(estimate: unknown, vehicle: { id: string; variantId: string | null; variantResolution: string | null }) {
    const serviceRow = { id: 's1', name: 'Troca de embreagem', defaultPrice: 500, pricingMode: 'FIXED', definitionId: 'def1' };
    const tx = {
      customer: { findFirst: vi.fn().mockResolvedValue({ id: 'c1' }), create: vi.fn(), findUnique: vi.fn() },
      vehicle: { upsert: vi.fn().mockResolvedValue(vehicle) },
      vehicleOwner: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
      part: { findMany: vi.fn().mockResolvedValue([]) },
      service: { findMany: vi.fn().mockResolvedValue([serviceRow]) },
      tenantFiscalSettings: { findUnique: vi.fn().mockResolvedValue({ hourlyRate: 100 }) },
      serviceOrder: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'o1', status: 'QUOTE' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'o1', number: 1, status: 'QUOTE', portalToken: 't', customer: { id: 'x', name: 'n', email: null, phone: null },
          vehicle: { plate: 'ABC1D23', brand: 'FIAT', model: 'Palio' }, createdBy: null, assignedTo: null,
        }),
      },
      outboxEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    const variants ={ attachToVehicle: vi.fn().mockResolvedValue(null) };
    const learning = { estimateFor: vi.fn().mockResolvedValue(estimate), recordForOrder: vi.fn() };
    return { tx, learning, serviceRow, service: new ServiceOrdersService(prisma as never, variants as never, learning as never) };
  }
  const withVariant = { id: 'v1', variantId: 'ver1', variantResolution: 'FIPE' };
  const input = (line: object) =>
    ({ customerPhone: '11987654321', vehicle: { plate: 'ABC1D23', brand: 'FIAT', model: 'Palio' }, partLines: [], serviceLines: [{ serviceId: 's1', ...line }] }) as never;
  const createdLine = (tx: ReturnType<typeof setup>['tx']) => tx.serviceOrder.create.mock.calls[0][0].data.serviceLines.create[0];

  it('grava o snapshot da variante e da estimativa aprendida na linha', async () => {
    const { service, tx, learning } = setup(learned, withVariant);
    await service.create(input({}), user);
    expect(learning.estimateFor).toHaveBeenCalledWith(tx, 'def1', 'ver1');
    expect(createdLine(tx)).toMatchObject({
      serviceId: 's1',
      variantId: 'ver1',
      variantResolution: 'FIPE',
      hoursEstimated: 4.5,
      hoursEstimateSource: 'LEARNED',
    });
  });

  it('referência: mostra o valor mas marca REFERENCE (não será pré-preenchido)', async () => {
    const { service, tx } = setup({ ...learned, source: 'REFERENCE', hours: 6, sampleCount: 1 }, withVariant);
    await service.create(input({}), user);
    expect(createdLine(tx)).toMatchObject({ hoursEstimated: 6, hoursEstimateSource: 'REFERENCE' });
  });

  it('sem histórico: NONE e sem horas', async () => {
    const { service, tx } = setup({ source: 'NONE' }, withVariant);
    await service.create(input({}), user);
    expect(createdLine(tx)).toMatchObject({ hoursEstimated: null, hoursEstimateSource: 'NONE' });
  });

  it('horas informadas manualmente na criação: MANUAL, prevalecem sobre a estimativa', async () => {
    const { service, tx } = setup(learned, withVariant);
    await service.create(input({ hours: 7 }), user);
    expect(createdLine(tx)).toMatchObject({ hoursEstimated: 7, hoursEstimateSource: 'MANUAL' });
  });

  it('guarda o texto livre (NFS-e) em description, sem afetar o nome do serviço', async () => {
    const { service, tx } = setup({ source: 'NONE' }, withVariant);
    await service.create(input({ description: 'Embreagem do Palio 1.0 com troca do volante' }), user);
    expect(createdLine(tx)).toMatchObject({
      serviceName: 'Troca de embreagem',
      description: 'Embreagem do Palio 1.0 com troca do volante',
    });
  });

  it('serviço HOURLY: preço = horas × valor-hora da oficina', async () => {
    const { service, tx, serviceRow } = setup(learned, withVariant);
    Object.assign(serviceRow, { pricingMode: 'HOURLY' });
    await service.create(input({}), user);
    expect(createdLine(tx).price).toBe(450);
  });

  it('serviço HOURLY sem horas conhecidas cai no preço padrão', async () => {
    const { service, tx, serviceRow } = setup({ source: 'NONE' }, withVariant);
    Object.assign(serviceRow, { pricingMode: 'HOURLY' });
    await service.create(input({}), user);
    expect(createdLine(tx).price).toBe(500);
  });

  it('preço informado na linha prevalece sobre o cálculo por hora', async () => {
    const { service, tx, serviceRow } = setup(learned, withVariant);
    Object.assign(serviceRow, { pricingMode: 'HOURLY' });
    await service.create(input({ price: 300 }), user);
    expect(createdLine(tx).price).toBe(300);
  });

  it('veículo sem variante: a estimativa é consultada com null (NONE)', async () => {
    const { service, learning, tx } = setup({ source: 'NONE' }, { id: 'v1', variantId: null, variantResolution: null });
    await service.create(input({}), user);
    expect(learning.estimateFor).toHaveBeenCalledWith(tx, 'def1', null);
    expect(createdLine(tx)).toMatchObject({ variantId: null, hoursEstimateSource: 'NONE' });
  });

  it('usa a variante recém-resolvida quando o lookup trouxe uma', async () => {
    const { service, tx, learning } = setup({ source: 'NONE' }, { id: 'v1', variantId: null, variantResolution: null });
    // sobrescreve o stub: attachToVehicle resolve uma variante nova
    const variants = { attachToVehicle: vi.fn().mockResolvedValue({ variantId: 'fresh', resolution: 'FAMILY' }) };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    const svc = new ServiceOrdersService(prisma as never, variants as never, learning as never);
    await svc.create(input({}), user);
    expect(learning.estimateFor).toHaveBeenCalledWith(tx, 'def1', 'fresh');
    expect(createdLine(tx)).toMatchObject({ variantId: 'fresh', variantResolution: 'FAMILY' });
    void service;
  });
});
