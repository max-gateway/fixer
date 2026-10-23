import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoicesController } from './invoices.controller.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = (principal: object = { tenantId: ORG, storeId: ORG, catalogs: ['rocket-autopecas'] }) => ({ headers: { authorization: 'Bearer user-jwt' }, principal }) as never;
const CALLER = { token: 'user-jwt', orgId: ORG };
const live = { sku: 'cat-1', name: 'Bieleta Estabilizadora', partNumber: 'BE-123', barcodes: [], active: true, retired: false, etag: 'a'.repeat(32) };

describe('InvoicesController.createPart (cadastro pelo item da nota, com ou sem peça do catálogo)', () => {
  const invoices = { createPartFromItem: vi.fn() };
  const links = { resolveLive: vi.fn() };
  const controller = new InvoicesController(invoices as never, {} as never, links as never);
  const body = { sellPrice: 70, unitFactor: 1, saveMapping: true };

  beforeEach(() => {
    invoices.createPartFromItem.mockReset().mockResolvedValue({ ok: true });
    links.resolveLive.mockReset().mockResolvedValue(live);
  });

  it('sem catalogSku: o cadastro é o de sempre e a plataforma nem é consultada', async () => {
    await controller.createPart('inv1', 2, body, request());
    expect(links.resolveLive).not.toHaveBeenCalled();
    expect(invoices.createPartFromItem).toHaveBeenCalledWith('inv1', 2, expect.objectContaining({ sellPrice: 70 }), undefined);
  });

  it('com catalogSku: resolve a peça do catálogo com o token do usuário ANTES de cadastrar e repassa o que achou', async () => {
    await controller.createPart('inv1', 2, { ...body, catalogSku: 'cat-1' }, request());
    expect(links.resolveLive).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', 'cat-1');
    expect(invoices.createPartFromItem).toHaveBeenCalledWith('inv1', 2, expect.objectContaining({ catalogSku: 'cat-1' }), { sku: 'cat-1', name: 'Bieleta Estabilizadora', partNumber: 'BE-123' });
    expect(links.resolveLive.mock.invocationCallOrder[0]).toBeLessThan(invoices.createPartFromItem.mock.invocationCallOrder[0]!);
  });

  it('peça do catálogo inexistente (404) ou retirada (422): nada é cadastrado', async () => {
    links.resolveLive.mockRejectedValue(new NotFoundException('Peça não encontrada no catálogo'));
    await expect(controller.createPart('inv1', 2, { ...body, catalogSku: 'cat-1' }, request())).rejects.toBeInstanceOf(NotFoundException);
    links.resolveLive.mockRejectedValue(new UnprocessableEntityException('retirada'));
    await expect(controller.createPart('inv1', 2, { ...body, catalogSku: 'cat-1' }, request())).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(invoices.createPartFromItem).not.toHaveBeenCalled();
  });

  it('catálogo explícito precisa ser um dos do usuário (404 idêntico); sem catálogo configurado, 403', async () => {
    await expect(controller.createPart('inv1', 2, { ...body, catalogSku: 'cat-1', catalog: 'alheio' }, request())).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.createPart('inv1', 2, { ...body, catalogSku: 'cat-1' }, request({ tenantId: ORG, catalogs: [] }))).rejects.toThrow();
    expect(links.resolveLive).not.toHaveBeenCalled();
  });

  it('catalog sem catalogSku não faz sentido: 400', async () => {
    await expect(controller.createPart('inv1', 2, { ...body, catalog: 'rocket-autopecas' }, request())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('corpo inválido: 400, e nada é consultado nem cadastrado', async () => {
    await expect(controller.createPart('inv1', 2, { sellPrice: -1 }, request())).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.createPart('inv1', 2, { ...body, catalogSku: '' }, request())).rejects.toBeInstanceOf(BadRequestException);
    expect(links.resolveLive).not.toHaveBeenCalled();
    expect(invoices.createPartFromItem).not.toHaveBeenCalled();
  });
});
