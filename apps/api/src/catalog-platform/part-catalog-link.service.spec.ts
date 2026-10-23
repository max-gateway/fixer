import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallerContext } from './catalog-platform.service.js';
import { PartCatalogLinkService } from './part-catalog-link.service.js';

const CATALOG = 'rocket-autopecas';
const caller: CallerContext = { token: 'user-jwt', orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

const catalogPart = (over: Record<string, unknown> = {}) => ({
  sku: 'cat-1',
  name: 'Bieleta Estabilizadora',
  partNumber: 'BE-123',
  barcodes: ['7891111111111', '7892222222222'],
  active: true,
  retired: false,
  etag: 'a'.repeat(32),
  ...over,
});
/** Formato REAL do erro com o cliente de tenant da API (provado em part-catalog-link.integration.spec.ts): o Prisma não nomeia o campo. */
const unique = () => Object.assign(new Error('unique'), { code: 'P2002', meta: { modelName: 'Part', target: null } });

function build() {
  const prisma = {
    part: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    purchaseInvoice: { findUnique: vi.fn() },
    purchaseInvoiceItem: { findMany: vi.fn() },
  };
  const platform = { lookupParts: vi.fn(), lookupBarcodes: vi.fn() };
  const service = new PartCatalogLinkService(prisma as never, platform as never);
  return { prisma, platform, service };
}

describe('PartCatalogLinkService.createFromCatalog', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.platform.lookupParts.mockResolvedValue({ items: [catalogPart()], missing: [] });
    ctx.prisma.part.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'p1', ...data }));
  });
  const input = { catalogSku: 'cat-1', costPrice: 10, sellPrice: 20 };

  it('cria a peça da oficina a partir da peça do catálogo: nome, GTIN e SKU vêm do catálogo; o vínculo nasce junto', async () => {
    const part = await ctx.service.createFromCatalog(caller, CATALOG, input);
    expect(ctx.platform.lookupParts).toHaveBeenCalledWith(caller, CATALOG, ['cat-1']);
    expect(ctx.prisma.part.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sku: 'BE-123',
        name: 'Bieleta Estabilizadora',
        ean: '7891111111111',
        costPrice: 10,
        sellPrice: 20,
        catalogSku: 'cat-1',
        catalogLinkSource: 'CREATED_FROM_CATALOG',
        catalogLinkedAt: expect.any(Date),
      }),
    });
    expect(part).toMatchObject({ id: 'p1', catalogSku: 'cat-1' });
  });

  it('o SKU interno da oficina pode ser informado; sem GTIN no catálogo, o EAN fica nulo', async () => {
    ctx.platform.lookupParts.mockResolvedValue({ items: [catalogPart({ barcodes: [] })], missing: [] });
    await ctx.service.createFromCatalog(caller, CATALOG, { ...input, sku: 'PRATELEIRA-7', supplierName: 'Fornecedor X' });
    expect(ctx.prisma.part.create.mock.calls[0]![0].data).toMatchObject({ sku: 'PRATELEIRA-7', ean: null, supplierName: 'Fornecedor X' });
  });

  it('peça que não existe no catálogo: 404, e nada é criado', async () => {
    ctx.platform.lookupParts.mockResolvedValue({ items: [], missing: ['cat-1'] });
    await expect(ctx.service.createFromCatalog(caller, CATALOG, input)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.prisma.part.create).not.toHaveBeenCalled();
  });

  it.each([
    ['retirada', { retired: true, active: false }],
    ['inativa', { active: false }],
  ])('peça %s no catálogo: 422, e nada é criado', async (_n, over) => {
    ctx.platform.lookupParts.mockResolvedValue({ items: [catalogPart(over)], missing: [] });
    await expect(ctx.service.createFromCatalog(caller, CATALOG, input)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(ctx.prisma.part.create).not.toHaveBeenCalled();
  });

  it('a peça do catálogo já está no estoque da oficina: 409 com a mensagem certa (a causa vem do banco, não do erro)', async () => {
    ctx.prisma.part.create.mockRejectedValue(unique());
    ctx.prisma.part.findFirst.mockResolvedValue({ id: 'ja-existe' });
    await expect(ctx.service.createFromCatalog(caller, CATALOG, input)).rejects.toThrow(/já está no estoque/);
    expect(ctx.prisma.part.findFirst).toHaveBeenCalledWith({ where: { catalogSku: 'cat-1' }, select: { id: true } });
  });

  it('SKU interno repetido (a peça do catálogo NÃO está no estoque): 409 com a mensagem do SKU', async () => {
    ctx.prisma.part.create.mockRejectedValue(unique());
    ctx.prisma.part.findFirst.mockResolvedValue(null);
    const e = await ctx.service.createFromCatalog(caller, CATALOG, input).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as Error).message).toMatch(/SKU/);
  });

  it('erro que não é de unicidade sobe como está', async () => {
    ctx.prisma.part.create.mockRejectedValue(new RangeError('bug'));
    await expect(ctx.service.createFromCatalog(caller, CATALOG, input)).rejects.toBeInstanceOf(RangeError);
  });

  it('a plataforma indisponível sobe o erro traduzido dela (503), e nada é criado', async () => {
    ctx.platform.lookupParts.mockRejectedValue(new Error('503 traduzido'));
    await expect(ctx.service.createFromCatalog(caller, CATALOG, input)).rejects.toThrow('503 traduzido');
    expect(ctx.prisma.part.create).not.toHaveBeenCalled();
  });
});

describe('PartCatalogLinkService.resolveLive (a peça do catálogo que pode ser usada)', () => {
  it('devolve a peça quando existe e está viva', async () => {
    const ctx = build();
    ctx.platform.lookupParts.mockResolvedValue({ items: [catalogPart()], missing: [] });
    await expect(ctx.service.resolveLive(caller, CATALOG, 'cat-1')).resolves.toMatchObject({ sku: 'cat-1', partNumber: 'BE-123' });
    expect(ctx.platform.lookupParts).toHaveBeenCalledWith(caller, CATALOG, ['cat-1']);
  });

  it('inexistente: 404; retirada ou inativa: 422', async () => {
    const ctx = build();
    ctx.platform.lookupParts.mockResolvedValue({ items: [], missing: ['cat-1'] });
    await expect(ctx.service.resolveLive(caller, CATALOG, 'cat-1')).rejects.toBeInstanceOf(NotFoundException);
    ctx.platform.lookupParts.mockResolvedValue({ items: [catalogPart({ retired: true, active: false })], missing: [] });
    await expect(ctx.service.resolveLive(caller, CATALOG, 'cat-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('PartCatalogLinkService.link e unlink', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.platform.lookupParts.mockResolvedValue({ items: [catalogPart()], missing: [] });
    ctx.prisma.part.findUnique.mockResolvedValue({ id: 'p1', catalogSku: null });
    ctx.prisma.part.updateMany.mockResolvedValue({ count: 1 });
  });

  it('vincula uma peça local a uma peça do catálogo (origem MANUAL), só se ela ainda não estiver vinculada', async () => {
    const out = await ctx.service.link(caller, CATALOG, 'p1', 'cat-1');
    expect(ctx.prisma.part.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', catalogSku: null },
      data: { catalogSku: 'cat-1', catalogLinkedAt: expect.any(Date), catalogLinkSource: 'MANUAL' },
    });
    expect(out).toEqual({ id: 'p1', catalogSku: 'cat-1' });
  });

  it('peça local inexistente: 404; já vinculada: 409', async () => {
    ctx.prisma.part.findUnique.mockResolvedValue(null);
    await expect(ctx.service.link(caller, CATALOG, 'p1', 'cat-1')).rejects.toBeInstanceOf(NotFoundException);
    ctx.prisma.part.findUnique.mockResolvedValue({ id: 'p1', catalogSku: 'outra' });
    await expect(ctx.service.link(caller, CATALOG, 'p1', 'cat-1')).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.prisma.part.updateMany).not.toHaveBeenCalled();
  });

  it('peça do catálogo inexistente: 404; retirada ou inativa: 422', async () => {
    ctx.platform.lookupParts.mockResolvedValue({ items: [], missing: ['cat-1'] });
    await expect(ctx.service.link(caller, CATALOG, 'p1', 'cat-1')).rejects.toBeInstanceOf(NotFoundException);
    ctx.platform.lookupParts.mockResolvedValue({ items: [catalogPart({ active: false })], missing: [] });
    await expect(ctx.service.link(caller, CATALOG, 'p1', 'cat-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('outra peça da oficina já usa essa peça do catálogo: 409', async () => {
    ctx.prisma.part.updateMany.mockRejectedValue(unique());
    await expect(ctx.service.link(caller, CATALOG, 'p1', 'cat-1')).rejects.toThrow(/já está no estoque/);
  });

  it('corrida: alguém vinculou a peça entre a leitura e a escrita (nenhuma linha atualizada): 409', async () => {
    ctx.prisma.part.updateMany.mockResolvedValue({ count: 0 });
    await expect(ctx.service.link(caller, CATALOG, 'p1', 'cat-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('desvincular zera os três campos do vínculo juntos; peça inexistente é 404; peça sem vínculo não faz nada', async () => {
    ctx.prisma.part.findUnique.mockResolvedValue({ id: 'p1', catalogSku: 'cat-1' });
    ctx.prisma.part.update.mockResolvedValue({});
    await ctx.service.unlink('p1');
    expect(ctx.prisma.part.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { catalogSku: null, catalogLinkedAt: null, catalogLinkSource: null } });

    ctx.prisma.part.update.mockClear();
    ctx.prisma.part.findUnique.mockResolvedValue({ id: 'p1', catalogSku: null });
    await ctx.service.unlink('p1');
    expect(ctx.prisma.part.update).not.toHaveBeenCalled();

    ctx.prisma.part.findUnique.mockResolvedValue(null);
    await expect(ctx.service.unlink('zzz')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PartCatalogLinkService.linkByBarcode (vínculo em lote pelo GTIN)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.prisma.part.findMany.mockImplementation(async ({ where }: { where: { catalogSku: null | { in: string[] } } }) =>
      where.catalogSku === null
        ? [
            { id: 'p1', ean: '7891111111111' },
            { id: 'p2', ean: '7893333333333' },
            { id: 'p3', ean: '7894444444444' },
          ]
        : [{ id: 'p9', catalogSku: 'cat-3' }],
    );
    ctx.platform.lookupBarcodes.mockResolvedValue({
      matches: [
        { barcode: '7891111111111', skus: ['cat-1'] }, // p1: vinculável
        { barcode: '7893333333333', skus: ['cat-3'] }, // p2: cat-3 já é da p9: conflito
        { barcode: '7894444444444', skus: [] }, // p3: sem correspondência
      ],
    });
    ctx.prisma.part.updateMany.mockResolvedValue({ count: 1 });
  });

  it('só olha peças ainda sem vínculo e com GTIN, e consulta o catálogo por lote', async () => {
    await ctx.service.linkByBarcode(caller, CATALOG, { apply: false });
    expect(ctx.prisma.part.findMany.mock.calls[0]![0].where).toEqual({ catalogSku: null, ean: { not: null } });
    expect(ctx.platform.lookupBarcodes).toHaveBeenCalledWith(caller, CATALOG, ['7891111111111', '7893333333333', '7894444444444']);
  });

  it('sem apply: só informa o que faria (nada é gravado)', async () => {
    const report = await ctx.service.linkByBarcode(caller, CATALOG, { apply: false });
    expect(ctx.prisma.part.updateMany).not.toHaveBeenCalled();
    expect(report.summary).toEqual({ linkable: 1, ambiguousCatalog: 0, ambiguousLocal: 0, conflict: 1, noMatch: 1, linked: 0 });
    expect(report.scanned).toBe(3);
  });

  it('com apply: vincula só as vináveis, com origem EAN, protegido contra vínculo concorrente', async () => {
    const report = await ctx.service.linkByBarcode(caller, CATALOG, { apply: true });
    expect(ctx.prisma.part.updateMany).toHaveBeenCalledTimes(1);
    expect(ctx.prisma.part.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', catalogSku: null },
      data: { catalogSku: 'cat-1', catalogLinkedAt: expect.any(Date), catalogLinkSource: 'EAN' },
    });
    expect(report.summary.linked).toBe(1);
  });

  it('uma peça que perdeu a corrida (unicidade ou já vinculada) vira conflito, sem derrubar as demais', async () => {
    ctx.prisma.part.updateMany.mockRejectedValue(unique());
    const report = await ctx.service.linkByBarcode(caller, CATALOG, { apply: true });
    expect(report.summary.linked).toBe(0);
    expect(report.summary.conflict).toBe(2);
  });

  it('consulta o catálogo de 100 em 100 GTIN', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, ean: String(7890000000000 + i) }));
    ctx.prisma.part.findMany.mockImplementation(async ({ where }: { where: { catalogSku: null | { in: string[] } } }) => (where.catalogSku === null ? many : []));
    ctx.platform.lookupBarcodes.mockResolvedValue({ matches: [] });
    await ctx.service.linkByBarcode(caller, CATALOG, { apply: false });
    expect(ctx.platform.lookupBarcodes.mock.calls.map((c) => (c[2] as string[]).length)).toEqual([100, 100, 50]);
  });

  it('o relatório traz os vereditos (limitados) e avisa quando havia mais peças que o limite', async () => {
    const report = await ctx.service.linkByBarcode(caller, CATALOG, { apply: false });
    expect(report.items.map((v) => v.kind)).toEqual(['LINKABLE', 'CONFLICT', 'NO_MATCH']);
    expect(report.truncated).toBe(false);
  });

  it('sem nenhuma peça candidata: relatório vazio e nenhuma chamada à plataforma', async () => {
    ctx.prisma.part.findMany.mockResolvedValue([]);
    const report = await ctx.service.linkByBarcode(caller, CATALOG, { apply: true });
    expect(report.scanned).toBe(0);
    expect(ctx.platform.lookupBarcodes).not.toHaveBeenCalled();
  });
});

describe('PartCatalogLinkService.suggestForInvoice (itens da nota × catálogo)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.prisma.purchaseInvoice.findUnique.mockResolvedValue({ id: 'inv1' });
    ctx.prisma.purchaseInvoiceItem.findMany.mockResolvedValue([
      { id: 'i1', ean: '7891111111111' },
      { id: 'i2', ean: '7892222222222' },
      { id: 'i3', ean: '7893333333333' },
    ]);
    ctx.platform.lookupBarcodes.mockResolvedValue({
      matches: [
        { barcode: '7891111111111', skus: ['cat-1'] },
        { barcode: '7892222222222', skus: ['cat-2'] },
        { barcode: '7893333333333', skus: ['cat-3', 'cat-4'] },
      ],
    });
    ctx.prisma.part.findMany.mockResolvedValue([{ id: 'p1', sku: 'BE-1', name: 'Bieleta da oficina', catalogSku: 'cat-1' }]);
  });

  it('sugere a peça da oficina já vinculada à peça do catálogo do GTIN, com o nome e o SKU dela para a tela; GTIN ambíguo ou sem peça vinculada não sugere', async () => {
    const out = await ctx.service.suggestForInvoice(caller, CATALOG, 'inv1');
    expect(out.suggestions).toEqual([{ itemId: 'i1', partId: 'p1', partSku: 'BE-1', partName: 'Bieleta da oficina', catalogSku: 'cat-1' }]);
    expect(out.unmatched).toBe(2);
  });

  it('só olha itens ainda sem resolução e com GTIN', async () => {
    await ctx.service.suggestForInvoice(caller, CATALOG, 'inv1');
    expect(ctx.prisma.purchaseInvoiceItem.findMany.mock.calls[0]![0].where).toEqual({ invoiceId: 'inv1', resolution: 'UNRESOLVED', ean: { not: null } });
  });

  it('nota inexistente: 404', async () => {
    ctx.prisma.purchaseInvoice.findUnique.mockResolvedValue(null);
    await expect(ctx.service.suggestForInvoice(caller, CATALOG, 'zzz')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem itens candidatos: nada a sugerir e nenhuma chamada à plataforma', async () => {
    ctx.prisma.purchaseInvoiceItem.findMany.mockResolvedValue([]);
    const out = await ctx.service.suggestForInvoice(caller, CATALOG, 'inv1');
    expect(out).toEqual({ suggestions: [], unmatched: 0 });
    expect(ctx.platform.lookupBarcodes).not.toHaveBeenCalled();
  });
});
