import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ServiceOrdersService } from './service-orders.service.js';

describe('ServiceOrdersService.create — limite de ordens do plano', () => {
  const input = { customerId: 'c1', vehicle: { plate: 'ABC1D23', brand: 'Fiat', model: 'Palio' } } as never;
  const user = { id: 'u1', keycloakId: 'k', name: 'U', email: 'u@x.test' };

  it('limite atingido: responde 402 ANTES de abrir transação ou tocar em qualquer tabela', async () => {
    const prisma = { $transaction: vi.fn() };
    const limits = {
      assertOrderSlot: vi.fn(async () => {
        throw new HttpException({ error: 'plan_limit_reached' }, 402);
      }),
    };
    const service = new ServiceOrdersService(prisma as never, {} as never, {} as never, limits as never);
    await expect(service.create(input, user)).rejects.toMatchObject({ status: 402 });
    expect(limits.assertOrderSlot).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('dentro do limite segue para a transação normalmente', async () => {
    const prisma = { $transaction: vi.fn(async () => 'criada') };
    const limits = { assertOrderSlot: vi.fn(async () => undefined) };
    const service = new ServiceOrdersService(prisma as never, {} as never, {} as never, limits as never);
    await expect(service.create(input, user)).resolves.toBe('criada');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
