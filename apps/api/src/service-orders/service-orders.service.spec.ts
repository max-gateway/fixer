import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ServiceOrdersService } from './service-orders.service.js';
import { CreateServiceOrderSchema } from './schema.js';

const user = { id: 'u1', keycloakId: 'k', name: 'Ana', email: 'a@x.com' };

function setup(order: { status: string; partLines: unknown[] } | null, stockUpdateCount = 1) {
  const tx = {
    serviceOrder: {
      findUnique: vi.fn().mockResolvedValue(order && { id: 'o1', number: 7, serviceLines: [], ...order }),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'o1', status: 'APPROVED' }),
    },
    part: {
      updateMany: vi.fn().mockResolvedValue({ count: stockUpdateCount }),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ stockQty: 5 }),
    },
    stockMovement: { create: vi.fn() },
    serviceOrderStatusLog: { create: vi.fn() },
    serviceOrderEvent: { create: vi.fn() },
    outboxEvent: { create: vi.fn() },
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const learning = { recordForOrder: vi.fn().mockResolvedValue(undefined), estimateFor: vi.fn() };
  return { tx, service: new ServiceOrdersService(prisma as never, { attachToVehicle: vi.fn() } as never, learning as never) };
}

const line = { id: 'l1', partId: 'p1', partName: 'Filtro', quantity: 2 };

describe('ServiceOrdersService.transition', () => {
  it('QUOTE -> APPROVED debita o estoque e registra SALE_CONSUMPTION', async () => {
    const { tx, service } = setup({ status: 'QUOTE', partLines: [line] });
    await service.transition('o1', { status: 'APPROVED' }, user);
    expect(tx.part.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', stockQty: { gte: 2 } },
      data: { stockQty: { decrement: 2 } },
    });
    expect(tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({
      type: 'SALE_CONSUMPTION',
      balanceAfter: 5,
      serviceOrderPartLineId: 'l1',
    });
    expect(tx.serviceOrderStatusLog.create.mock.calls[0][0].data).toMatchObject({
      fromStatus: 'QUOTE',
      toStatus: 'APPROVED',
      changedById: 'u1',
    });
  });

  it('registra a transição como evento visível no portal do cliente', async () => {
    const { tx, service } = setup({ status: 'APPROVED', partLines: [] });
    await service.transition('o1', { status: 'IN_PROGRESS', note: 'Começamos hoje' }, user);
    expect(tx.serviceOrderEvent.create.mock.calls[0][0].data).toMatchObject({
      serviceOrderId: 'o1',
      type: 'STATUS_CHANGE',
      author: 'SHOP',
      authorName: 'Ana',
      body: 'Começamos hoje',
      data: { from: 'APPROVED', to: 'IN_PROGRESS' },
    });
  });

  it('registra order.status_changed no outbox, na mesma transação', async () => {
    const { tx, service } = setup({ status: 'APPROVED', partLines: [] });
    await service.transition('o1', { status: 'IN_PROGRESS', note: 'ok' }, user);
    const row = tx.outboxEvent.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ type: 'order.status_changed', aggregateType: 'service_order', aggregateId: 'o1' });
    expect(row.payload).toMatchObject({
      version: 1,
      actor: { kind: 'staff', id: 'u1' },
      data: { from: 'APPROVED', to: 'IN_PROGRESS', note: 'ok' },
    });
  });

  it('falha com Conflict e não muda status se o estoque é insuficiente', async () => {
    const { tx, service } = setup({ status: 'QUOTE', partLines: [line] }, 0);
    await expect(service.transition('o1', { status: 'APPROVED' }, user)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.serviceOrder.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('cancelar depois de aprovada devolve o estoque (RETURN)', async () => {
    const { tx, service } = setup({ status: 'IN_PROGRESS', partLines: [line] });
    await service.transition('o1', { status: 'CANCELLED' }, user);
    expect(tx.part.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { stockQty: { increment: 2 } },
    });
    expect(tx.stockMovement.create.mock.calls[0][0].data.type).toBe('RETURN');
    expect(tx.serviceOrder.update.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date);
  });

  it('cancelar um orçamento não mexe no estoque', async () => {
    const { tx, service } = setup({ status: 'QUOTE', partLines: [line] });
    await service.transition('o1', { status: 'CANCELLED' }, user);
    expect(tx.part.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('rejeita transição inválida', async () => {
    const { service } = setup({ status: 'DELIVERED', partLines: [] });
    await expect(service.transition('o1', { status: 'QUOTE' }, user)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ServiceOrdersService.create — por telefone', () => {
  const input = {
    customerPhone: '11987654321',
    vehicle: { plate: 'ABC1D23', brand: 'VW', model: 'Gol' },
    partLines: [],
    serviceLines: [],
  } as never;

  function setupCreate(existing: { id: string } | null) {
    const tx = {
      customer: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create: vi.fn().mockResolvedValue({ id: 'new-c', name: '(11) 98765-4321', phone: '11987654321' }),
        findUnique: vi.fn(),
      },
      vehicle: { upsert: vi.fn().mockResolvedValue({ id: 'v1' }) },
      vehicleOwner: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
      part: { findMany: vi.fn().mockResolvedValue([]) },
      service: { findMany: vi.fn().mockResolvedValue([]) },
      serviceOrder: {
        findUnique: vi.fn().mockResolvedValue(null), // código de vínculo livre
        create: vi.fn().mockResolvedValue({ id: 'o1', status: 'QUOTE' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'o1', number: 1, status: 'QUOTE', portalToken: 't', customer: { id: 'x', name: 'n', email: null, phone: null },
          vehicle: { plate: 'ABC1D23', brand: 'VW', model: 'Gol' }, createdBy: null, assignedTo: null,
        }),
      },
      outboxEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    const variants = { attachToVehicle: vi.fn().mockResolvedValue(undefined) };
    const learning = { estimateFor: vi.fn().mockResolvedValue({ source: 'NONE' }), recordForOrder: vi.fn() };
    return { tx, variants, service: new ServiceOrdersService(prisma as never, variants as never, learning as never) };
  }

  it('sem cadastro com esse telefone: cria um cliente pendente (sem documento) só com o telefone', async () => {
    const { tx, service } = setupCreate(null);
    await service.create(input, user);
    expect(tx.customer.create).toHaveBeenCalledWith({ data: { phone: '11987654321', name: '(11) 98765-4321' } });
    expect(tx.serviceOrder.create.mock.calls[0][0].data.customerId).toBe('new-c');
  });

  it('sem telefone: cria um cliente pendente identificado pela placa (o número vem do vínculo por WhatsApp)', async () => {
    const { tx, service } = setupCreate({ id: 'nao-deve-usar' });
    await service.create({ ...(input as object), customerPhone: undefined } as never, user);
    expect(tx.customer.findFirst).not.toHaveBeenCalled(); // sem telefone não há como reconhecer cliente existente
    expect(tx.customer.create).toHaveBeenCalledWith({ data: { name: 'Cliente ABC1D23' } });
  });

  it('o schema aceita criar a OS sem telefone nem cliente', () => {
    const r = CreateServiceOrderSchema.safeParse({ vehicle: { plate: 'abc-1d23', brand: 'VW', model: 'Gol' } });
    expect(r.success).toBe(true);
  });

  it('normaliza o veículo na hierarquia de variantes a partir do lookup da placa', async () => {
    const { tx, variants, service } = setupCreate(null);
    await service.create(input, user);
    expect(variants.attachToVehicle).toHaveBeenCalledWith(tx, 'v1', 'ABC1D23');
  });

  it('já existe cadastro com o telefone: reaproveita, sem criar outro', async () => {
    const { tx, service } = setupCreate({ id: 'known-c' });
    await service.create(input, user);
    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.serviceOrder.create.mock.calls[0][0].data.customerId).toBe('known-c');
  });
});
