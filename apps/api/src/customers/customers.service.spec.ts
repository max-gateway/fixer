import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CreateCustomerSchema } from './schema.js';

function setup(overrides: Record<string, unknown> = {}) {
  const customer = { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), ...overrides };
  return { customer, service: new CustomersService({ customer } as never) };
}

describe('CreateCustomerSchema', () => {
  it('normaliza documento para dígitos e e-mail vazio para null', () => {
    const out = CreateCustomerSchema.parse({ name: ' Ana ', document: '123.456.789-01', email: '' });
    expect(out).toMatchObject({ name: 'Ana', document: '12345678901', email: null });
  });

  it('rejeita documento com tamanho inválido', () => {
    expect(CreateCustomerSchema.safeParse({ name: 'Ana', document: '123' }).success).toBe(false);
  });
});

describe('CustomersService', () => {
  it('get lança NotFound quando não existe', async () => {
    const { customer, service } = setup();
    customer.findUnique.mockResolvedValue(null);
    await expect(service.get('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create converte violação de unique em Conflict', async () => {
    const { customer, service } = setup();
    customer.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create({ name: 'A', document: '12345678901' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('update converte P2025 em NotFound', async () => {
    const { customer, service } = setup();
    customer.update.mockRejectedValue({ code: 'P2025' });
    await expect(service.update('x', { name: 'B' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
