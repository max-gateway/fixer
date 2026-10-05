import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PortalService } from './portal.service.js';
import { CustomerDataSchema } from './schema.js';

const pending = { id: 'c-pending', name: '(11) 98765-4321', document: null, phone: '11987654321', email: null };
const profile = (over: Record<string, unknown> = {}) =>
  CustomerDataSchema.parse({ name: 'Maria Souza', document: '123.456.789-09', phone: '(11) 98765-4321', ...over });

function setup(customer: Record<string, unknown>, existingByDoc: Record<string, unknown> | null = null) {
  const tx = {
    customer: {
      findUnique: vi.fn().mockResolvedValue(existingByDoc),
      update: vi.fn(),
      delete: vi.fn(),
    },
    serviceOrder: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ customerId: 'final-id' }),
      findUnique: vi.fn().mockResolvedValue({ id: 'o1', status: 'QUOTE', customerId: customer.id, customer }),
    },
    vehicleOwner: { updateMany: vi.fn() },
    serviceOrderEvent: { create: vi.fn() },
    outboxEvent: { create: vi.fn() },
  };
  // emitOrderEvent relê a ordem com o snapshot: reaproveita o mesmo findUniqueOrThrow.
  tx.serviceOrder.findUniqueOrThrow.mockResolvedValue({
    id: 'o1', number: 7, status: 'QUOTE', portalToken: 't', customerId: 'final-id',
    customer: { id: 'final-id', name: 'x', email: null, phone: null },
    vehicle: { plate: 'ABC1D23', brand: 'VW', model: 'Gol' }, createdBy: null, assignedTo: null,
  });
  const prisma = {
    serviceOrder: { findUnique: tx.serviceOrder.findUnique },
    customer: { findUnique: tx.customer.findUnique },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  return { tx, service: new PortalService(prisma as never) };
}

describe('PortalService.updateCustomer — cadastro pendente', () => {
  it('exige o CPF/CNPJ enquanto o cadastro está pendente', async () => {
    const { service } = setup(pending);
    await expect(service.updateCustomer('t', profile({ document: null }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('documento novo: grava o documento e os dados no próprio cadastro', async () => {
    const { service, tx } = setup(pending, null);
    const out = await service.updateCustomer('t', profile());
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 'c-pending' },
      data: expect.objectContaining({ document: '12345678909', name: 'Maria Souza' }),
    });
    expect(out.changed).toContain('CPF/CNPJ');
    expect(tx.customer.delete).not.toHaveBeenCalled();
  });

  it('documento já cadastrado com o MESMO telefone: funde, move ordens/veículos e apaga o pendente', async () => {
    const existing = { id: 'c-old', document: '12345678909', phone: '(11) 98765-4321', name: 'Maria S.', email: 'm@x.com' };
    const { service, tx } = setup(pending, existing);
    await service.updateCustomer('t', profile());
    expect(tx.serviceOrder.updateMany).toHaveBeenCalledWith({ where: { customerId: 'c-pending' }, data: { customerId: 'c-old' } });
    expect(tx.vehicleOwner.updateMany).toHaveBeenCalledWith({ where: { customerId: 'c-pending' }, data: { customerId: 'c-old' } });
    expect(tx.customer.delete).toHaveBeenCalledWith({ where: { id: 'c-pending' } });
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c-old' }, data: expect.not.objectContaining({ document: expect.anything() }) });
  });

  it('documento de OUTRO telefone: recusa e não altera nada', async () => {
    const existing = { id: 'c-old', document: '12345678909', phone: '11911112222', name: 'Outra Pessoa' };
    const { service, tx } = setup(pending, existing);
    await expect(service.updateCustomer('t', profile())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.customer.delete).not.toHaveBeenCalled();
  });
});

describe('PortalService.lookupCustomer', () => {
  const found = { id: 'c-old', document: '12345678909', phone: '11987654321', name: 'Maria Souza', email: 'm@x.com', zipCode: '01001000', street: 'Rua A', number: '1', complement: null, district: 'Centro', city: 'SP', state: 'SP' };

  it('mesmo telefone: devolve os dados para pré-preencher (sem o documento)', async () => {
    const { service } = setup(pending, found);
    const out = await service.lookupCustomer('t', '12345678909');
    expect(out).toMatchObject({ found: true, customer: { name: 'Maria Souza', city: 'SP' } });
    expect(JSON.stringify(out)).not.toContain('12345678909');
  });

  it('outro telefone ou documento inexistente: não revela nada (resposta idêntica)', async () => {
    expect(await setup(pending, { ...found, phone: '11900000000' }).service.lookupCustomer('t', '12345678909')).toEqual({ found: false });
    expect(await setup(pending, null).service.lookupCustomer('t', '12345678909')).toEqual({ found: false });
  });

  it('cadastro já identificado não permite busca', async () => {
    const { service } = setup({ ...pending, document: '99999999999' }, found);
    expect(await service.lookupCustomer('t', '12345678909')).toEqual({ found: false });
  });

  it('tem rate limit por token', async () => {
    const { service } = setup(pending, null);
    const run = async () => {
      for (let i = 0; i < 11; i++) await service.lookupCustomer('t', '12345678909');
    };
    await expect(run()).rejects.toThrow();
  });
});
