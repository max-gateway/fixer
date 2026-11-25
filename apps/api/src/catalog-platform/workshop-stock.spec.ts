import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkshopStockController } from './workshop-stock.controller.js';
import { WorkshopStockService } from './workshop-stock.service.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CALLER = { token: 'user-jwt', orgId: ORG };
const request = () => ({ headers: { authorization: 'Bearer user-jwt' }, principal: { tenantId: ORG, catalogs: ['autopecas'] } }) as never;

const local = (catalogSku: string, over: Record<string, unknown> = {}) => ({ id: `p-${catalogSku}`, sku: `L-${catalogSku}`, stockQty: '3', sellPrice: '89.9', catalogSku, ...over });

describe('WorkshopStockService', () => {
  const prisma = { part: { findMany: vi.fn(), count: vi.fn() } };
  const platform = { lookupParts: vi.fn() };
  const service = new WorkshopStockService(prisma as never, platform as never);

  beforeEach(() => {
    prisma.part.findMany.mockReset();
    prisma.part.count.mockReset();
    platform.lookupParts.mockReset();
  });

  it('stockOf devolve saldo e preço como número, só das peças vinculadas', async () => {
    prisma.part.findMany.mockResolvedValue([local('c1'), local('c2', { stockQty: '0', sellPrice: '10' })]);
    const items = await service.stockOf(['c1', 'c2', 'c3']);
    expect(prisma.part.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { catalogSku: { in: ['c1', 'c2', 'c3'] } } }));
    expect(items).toEqual([
      { catalogSku: 'c1', partId: 'p-c1', sku: 'L-c1', stockQty: 3, sellPrice: 89.9 },
      { catalogSku: 'c2', partId: 'p-c2', sku: 'L-c2', stockQty: 0, sellPrice: 10 },
    ]);
  });

  describe('list ("só o que tenho")', () => {
    const lookup = (...skus: string[]) => ({
      items: skus.map((sku) => ({ sku, name: `Peça ${sku}`, partNumber: `PN-${sku}`, brand: { key: 'FIAT', name: 'Fiat' }, barcodes: [], active: true, retired: false, etag: 'x' })),
      missing: [],
    });

    it('filtra por vínculo, texto e saldo, pagina e mantém a ordem da oficina', async () => {
      prisma.part.count.mockResolvedValue(30);
      prisma.part.findMany.mockResolvedValue([local('c2'), local('c1')]);
      platform.lookupParts.mockResolvedValue(lookup('c1', 'c2'));

      const res = await service.list(CALLER, 'autopecas', { q: ' biel ', inStock: true, page: 2, limit: 24 });

      const where = prisma.part.count.mock.calls[0]![0].where;
      expect(where.catalogSku).toEqual({ not: null });
      expect(where.stockQty).toEqual({ gt: 0 });
      expect(where.OR).toHaveLength(2);
      expect(prisma.part.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 24, take: 24 }));
      expect(platform.lookupParts).toHaveBeenCalledWith(CALLER, 'autopecas', ['c2', 'c1']);
      expect(res.data.map((h) => h.sku)).toEqual(['c2', 'c1']);
      expect(res.data[0]!.workshop).toMatchObject({ stockQty: 3, sellPrice: 89.9, sku: 'L-c2' });
      expect(res).toMatchObject({ page: 2, limit: 24, total: 30, totalPages: 2 });
    });

    it('sem peças vinculadas não fala com a plataforma', async () => {
      prisma.part.count.mockResolvedValue(0);
      prisma.part.findMany.mockResolvedValue([]);
      const res = await service.list(CALLER, 'autopecas', { page: 1, limit: 24 });
      expect(platform.lookupParts).not.toHaveBeenCalled();
      expect(res).toEqual({ data: [], page: 1, limit: 24, total: 0, totalPages: 1 });
    });

    it('peça que o catálogo não tem mais fica de fora da página, sem derrubar as outras', async () => {
      prisma.part.count.mockResolvedValue(2);
      prisma.part.findMany.mockResolvedValue([local('c1'), local('c2')]);
      platform.lookupParts.mockResolvedValue({ ...lookup('c1'), missing: ['c2'] });
      const res = await service.list(CALLER, 'autopecas', { page: 1, limit: 24 });
      expect(res.data.map((h) => h.sku)).toEqual(['c1']);
      expect(res.total).toBe(2);
    });
  });
});

describe('WorkshopStockController', () => {
  const stock = { stockOf: vi.fn(), list: vi.fn() };
  const controller = new WorkshopStockController(stock as never);

  beforeEach(() => {
    stock.stockOf.mockReset().mockResolvedValue([]);
    stock.list.mockReset().mockResolvedValue({ data: [] });
  });

  it('stock aceita um sku ou vários, sem repetir', async () => {
    await controller.stockOf({ skus: ['a', 'b', 'a'] });
    expect(stock.stockOf).toHaveBeenCalledWith(['a', 'b']);
    await controller.stockOf({ skus: 'a' });
    expect(stock.stockOf).toHaveBeenLastCalledWith(['a']);
  });

  it.each([
    ['sem skus', {}],
    ['mais de 100 skus', { skus: Array.from({ length: 101 }, (_, i) => `s${i}`) }],
    ['parâmetro desconhecido', { skus: 'a', x: 1 }],
  ])('stock: 400 para %s', async (_n, query) => {
    await expect(controller.stockOf(query)).rejects.toBeInstanceOf(BadRequestException);
    expect(stock.stockOf).not.toHaveBeenCalled();
  });

  it('parts repassa filtros com padrões e o catálogo do usuário', async () => {
    await controller.parts({ q: 'biel', inStock: 'true' }, request());
    expect(stock.list).toHaveBeenCalledWith(CALLER, 'autopecas', { q: 'biel', inStock: true, page: 1, limit: 24 });
  });

  it.each([
    ['inStock que não é booleano', { inStock: 'sim' }],
    ['limite acima de 50', { limit: '51' }],
    ['parâmetro desconhecido', { foo: '1' }],
  ])('parts: 400 para %s', async (_n, query) => {
    await expect(controller.parts(query, request())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('parts: catálogo que o usuário não lê é 404', async () => {
    await expect(controller.parts({ catalog: 'outro' }, request())).rejects.toMatchObject({ status: 404 });
  });
});
