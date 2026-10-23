import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../auth/permissions.catalog.js';
import { REQUIRED_PERMISSION } from '../auth/permissions.js';
import { PartCatalogLinkController } from './part-catalog-link.controller.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = (principal: object = { tenantId: ORG, storeId: ORG, catalogs: ['rocket-autopecas'] }) =>
  ({ headers: { authorization: 'Bearer user-jwt' }, principal }) as never;
const CALLER = { token: 'user-jwt', orgId: ORG, storeId: ORG };

describe('PartCatalogLinkController', () => {
  const service = { createFromCatalog: vi.fn(), link: vi.fn(), unlink: vi.fn(), linkByBarcode: vi.fn(), suggestForInvoice: vi.fn() };
  const controller = new PartCatalogLinkController(service as never);

  beforeEach(() => {
    for (const fn of Object.values(service)) fn.mockReset().mockResolvedValue({ ok: true });
  });

  describe('POST /parts/from-catalog', () => {
    it('repassa o pedido ao serviço com o catálogo do usuário', async () => {
      await controller.fromCatalog({ catalogSku: 'cat-1', sku: 'P-7', costPrice: 10, sellPrice: 20.5, supplierName: 'Forn' }, request());
      expect(service.createFromCatalog).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', { catalogSku: 'cat-1', sku: 'P-7', costPrice: 10, sellPrice: 20.5, supplierName: 'Forn' });
    });

    it.each([
      ['sem catalogSku', { costPrice: 1, sellPrice: 1 }],
      ['preço negativo', { catalogSku: 'c', costPrice: -1, sellPrice: 1 }],
      ['preço que não é número', { catalogSku: 'c', costPrice: 'dez', sellPrice: 1 }],
      ['sem preço de venda', { catalogSku: 'c', costPrice: 1 }],
      ['sku interno vazio', { catalogSku: 'c', sku: '  ', costPrice: 1, sellPrice: 1 }],
      ['campo desconhecido', { catalogSku: 'c', costPrice: 1, sellPrice: 1, name: 'x' }],
    ])('400 para %s', async (_n, body) => {
      await expect(controller.fromCatalog(body, request())).rejects.toBeInstanceOf(BadRequestException);
      expect(service.createFromCatalog).not.toHaveBeenCalled();
    });

    it('o nome e o GTIN NÃO são aceitos no corpo: vêm do catálogo, nunca de quem pede', async () => {
      await expect(controller.fromCatalog({ catalogSku: 'c', costPrice: 1, sellPrice: 1, ean: '7891234567890' }, request())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('PUT /parts/:id/catalog-link', () => {
    it('vincula a peça ao catálogo', async () => {
      await controller.link('p1', { catalogSku: 'cat-1' }, request());
      expect(service.link).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', 'p1', 'cat-1');
    });

    it('400 sem catalogSku ou com campo desconhecido', async () => {
      await expect(controller.link('p1', {}, request())).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.link('p1', { catalogSku: 'c', x: 1 }, request())).rejects.toBeInstanceOf(BadRequestException);
      expect(service.link).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /parts/:id/catalog-link', () => {
    it('solta o vínculo (não fala com a plataforma)', async () => {
      await controller.unlink('p1');
      expect(service.unlink).toHaveBeenCalledWith('p1');
    });
  });

  describe('POST /parts/catalog-links/by-barcode', () => {
    it('sem apply, só simula; com apply:true, grava', async () => {
      await controller.linkByBarcode({}, request());
      expect(service.linkByBarcode).toHaveBeenLastCalledWith(CALLER, 'rocket-autopecas', { apply: false });
      await controller.linkByBarcode({ apply: true }, request());
      expect(service.linkByBarcode).toHaveBeenLastCalledWith(CALLER, 'rocket-autopecas', { apply: true });
    });

    it('400 quando apply não é booleano (texto "true" não vale: gravar exige intenção explícita)', async () => {
      await expect(controller.linkByBarcode({ apply: 'true' }, request())).rejects.toBeInstanceOf(BadRequestException);
      expect(service.linkByBarcode).not.toHaveBeenCalled();
    });
  });

  describe('GET /invoices/:id/catalog-suggestions', () => {
    it('repassa a nota ao serviço', async () => {
      await controller.suggestions('inv1', request());
      expect(service.suggestForInvoice).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', 'inv1');
    });
  });

  it('usuário sem catálogo configurado: 403 em todas as rotas que falam com a plataforma', async () => {
    const none = request({ tenantId: ORG, storeId: ORG, catalogs: [] });
    await expect(controller.fromCatalog({ catalogSku: 'c', costPrice: 1, sellPrice: 1 }, none)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.link('p1', { catalogSku: 'c' }, none)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.linkByBarcode({}, none)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.suggestions('inv1', none)).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('permissões (o PermissionGuard falha fechado)', () => {
    const permissionOf = (handler: keyof PartCatalogLinkController) => Reflect.getMetadata(REQUIRED_PERMISSION, PartCatalogLinkController.prototype[handler]);

    it('vincular, desvincular e vincular em lote exigem catalog.link; sugerir para a nota exige invoices.reconcile', () => {
      expect(permissionOf('link')).toBe('catalog.link');
      expect(permissionOf('unlink')).toBe('catalog.link');
      expect(permissionOf('linkByBarcode')).toBe('catalog.link');
      expect(permissionOf('suggestions')).toBe('invoices.reconcile');
    });

    it('criar a peça a partir do catálogo segue a regra de criar peça hoje (sem permissão própria)', () => {
      expect(permissionOf('fromCatalog')).toBeUndefined();
    });

    it('as permissões usadas existem no catálogo de permissões (senão ninguém, nem o Admin, as teria)', () => {
      const keys = PERMISSIONS.map((p) => p.key);
      expect(keys).toContain('catalog.link');
      expect(keys).toContain('invoices.reconcile');
    });
  });
});
