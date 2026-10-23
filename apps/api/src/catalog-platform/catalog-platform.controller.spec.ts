import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogPlatformController, callerFrom } from './catalog-platform.controller.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = (over: { authorization?: string; traceparent?: string; principal?: object | null } = {}) =>
  ({
    headers: {
      ...(over.authorization === undefined ? { authorization: 'Bearer user-jwt' } : over.authorization ? { authorization: over.authorization } : {}),
      ...(over.traceparent ? { traceparent: over.traceparent } : {}),
    },
    principal: over.principal === undefined ? { tenantId: ORG, storeId: ORG, catalogs: ['rocket-autopecas'] } : (over.principal ?? undefined),
  }) as never;

describe('callerFrom (quem está chamando a plataforma)', () => {
  it('token do usuário, organização e loja do Principal, e o traceparent da requisição', () => {
    expect(callerFrom(request({ traceparent: '00-abc-def-01' }))).toEqual({ token: 'user-jwt', orgId: ORG, storeId: ORG, traceparent: '00-abc-def-01' });
  });

  it('sem traceparent ou loja, esses campos ficam de fora', () => {
    const c = callerFrom(request({ principal: { tenantId: ORG, catalogs: [] } }));
    expect(c).toEqual({ token: 'user-jwt', orgId: ORG });
  });

  it('sem Bearer ou sem Principal: 401 (a rota nunca fala com a plataforma sem o usuário)', () => {
    expect(() => callerFrom(request({ authorization: '' }))).toThrow(UnauthorizedException);
    expect(() => callerFrom(request({ authorization: 'Basic abc' }))).toThrow(UnauthorizedException);
    expect(() => callerFrom(request({ principal: null }))).toThrow(UnauthorizedException);
  });
});

describe('CatalogPlatformController', () => {
  const service = { search: vi.fn(), autocomplete: vi.fn(), lookupParts: vi.fn(), lookupBarcodes: vi.fn() };
  const controller = new CatalogPlatformController(service as never);
  const CALLER = { token: 'user-jwt', orgId: ORG, storeId: ORG };

  beforeEach(() => {
    for (const fn of Object.values(service)) fn.mockReset().mockResolvedValue({ ok: true });
  });

  describe('GET /catalog/parts/search', () => {
    it('converte a consulta (texto → número), repassa ao serviço com o catálogo do usuário e devolve a resposta', async () => {
      const out = await controller.search({ q: ' bieleta ', page: '2', limit: '10', sort: 'relevance', brandKey: 'FIAT', categoryId: ['c1', 'c2'] }, request());
      expect(out).toEqual({ ok: true });
      expect(service.search).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', { q: 'bieleta', page: 2, limit: 10, sort: 'relevance', brandKey: ['FIAT'], categoryId: ['c1', 'c2'] });
    });

    it('só q é obrigatório', async () => {
      await controller.search({ q: 'abc' }, request());
      expect(service.search).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', { q: 'abc' });
    });

    it.each([
      ['sem q', {}],
      ['q vazio', { q: '   ' }],
      ['q acima de 200 caracteres', { q: 'x'.repeat(201) }],
      ['page 0', { q: 'a', page: '0' }],
      ['limit acima de 50', { q: 'a', limit: '51' }],
      ['limit que não é número', { q: 'a', limit: 'muitos' }],
      ['sort desconhecido', { q: 'a', sort: 'aleatorio' }],
      ['parâmetro desconhecido (o Fixer não repassa o que não conhece)', { q: 'a', storeId: 'outra-loja' }],
    ])('400 para %s, sem chamar a plataforma', async (_n, query) => {
      await expect(controller.search(query, request())).rejects.toBeInstanceOf(BadRequestException);
      expect(service.search).not.toHaveBeenCalled();
    });

    it('a loja vem do Principal, nunca da consulta', async () => {
      await expect(controller.search({ q: 'a', storeId: 'x' }, request())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('catálogo', () => {
    it('padrão: o primeiro catálogo que o usuário lê', async () => {
      await controller.search({ q: 'a' }, request({ principal: { tenantId: ORG, storeId: ORG, catalogs: ['um', 'dois'] } }));
      expect(service.search.mock.calls[0]![1]).toBe('um');
    });

    it('explícito: precisa estar entre os do usuário; senão 404 (idêntico a inexistente)', async () => {
      const principal = { tenantId: ORG, storeId: ORG, catalogs: ['um', 'dois'] };
      await controller.search({ q: 'a', catalog: 'dois' }, request({ principal }));
      expect(service.search.mock.calls[0]![1]).toBe('dois');
      await expect(controller.search({ q: 'a', catalog: 'alheio' }, request({ principal }))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('usuário sem nenhum catálogo configurado: 403', async () => {
      await expect(controller.search({ q: 'a' }, request({ principal: { tenantId: ORG, storeId: ORG, catalogs: [] } }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.search).not.toHaveBeenCalled();
    });
  });

  describe('GET /catalog/parts/autocomplete', () => {
    it('repassa q e limit (padrão da plataforma quando ausente)', async () => {
      await controller.autocomplete({ q: 'biel', limit: '5' }, request());
      expect(service.autocomplete).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', { q: 'biel', limit: 5 });
      await controller.autocomplete({ q: 'biel' }, request());
      expect(service.autocomplete).toHaveBeenLastCalledWith(CALLER, 'rocket-autopecas', { q: 'biel' });
    });

    it('400 sem q ou com limit acima de 50', async () => {
      await expect(controller.autocomplete({}, request())).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.autocomplete({ q: 'a', limit: '51' }, request())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('POST /catalog/parts/lookup', () => {
    it('repassa os skus (sem repetição) ao serviço', async () => {
      await controller.lookupParts({ skus: ['a', 'a', 'b'] }, request());
      expect(service.lookupParts).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', ['a', 'b']);
    });

    it.each([
      ['vazio', { skus: [] }],
      ['mais de 100', { skus: Array.from({ length: 101 }, (_, i) => `s${i}`) }],
      ['sku vazio', { skus: [''] }],
      ['sku grande demais', { skus: ['x'.repeat(65)] }],
      ['campo desconhecido', { skus: ['a'], extra: 1 }],
      ['sem skus', {}],
    ])('400 para %s', async (_n, body) => {
      await expect(controller.lookupParts(body, request())).rejects.toBeInstanceOf(BadRequestException);
      expect(service.lookupParts).not.toHaveBeenCalled();
    });
  });

  describe('POST /catalog/barcodes/lookup', () => {
    it('repassa os GTIN (sem repetição) ao serviço', async () => {
      await controller.lookupBarcodes({ barcodes: ['7891234567890', '7891234567890'] }, request());
      expect(service.lookupBarcodes).toHaveBeenCalledWith(CALLER, 'rocket-autopecas', ['7891234567890']);
    });

    it.each([
      ['vazio', { barcodes: [] }],
      ['mais de 100', { barcodes: Array.from({ length: 101 }, (_, i) => String(7890000000000 + i)) }],
      ['com letras', { barcodes: ['78912ABC'] }],
      ['curto demais', { barcodes: ['1234567'] }],
      ['longo demais', { barcodes: ['123456789012345'] }],
    ])('400 para %s', async (_n, body) => {
      await expect(controller.lookupBarcodes(body, request())).rejects.toBeInstanceOf(BadRequestException);
      expect(service.lookupBarcodes).not.toHaveBeenCalled();
    });
  });
});
