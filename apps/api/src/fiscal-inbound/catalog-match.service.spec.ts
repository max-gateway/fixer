import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogMatchService } from './catalog-match.service.js';

const CALLER = { token: 't', orgId: 'org' };
const ref = (sku: string) => ({ sku, name: `Peça ${sku}`, partNumber: `PN-${sku}` });
const item = (n: number, over: object = {}) => ({ id: `i${n}`, itemNumber: n, ean: null, description: `TDI100${n}-TERMINAL`, unit: 'PC', ...over });

describe('CatalogMatchService.matchInvoice', () => {
  const prisma = { purchaseInvoice: { findUnique: vi.fn() }, purchaseInvoiceItem: { findMany: vi.fn() }, part: { findMany: vi.fn(), findFirst: vi.fn() } };
  const links = { candidatesForItems: vi.fn(), lookupLive: vi.fn() };
  const invoices = { linkItemFromCatalog: vi.fn(), createPartFromItem: vi.fn() };
  const svc = new CatalogMatchService(prisma as never, links as never, invoices as never);

  beforeEach(() => {
    prisma.purchaseInvoice.findUnique.mockReset().mockResolvedValue({ id: 'inv', status: 'FULL', exportStatus: 'PENDING_MATCH' });
    prisma.purchaseInvoiceItem.findMany.mockReset().mockResolvedValue([item(1), item(2)]);
    prisma.part.findMany.mockReset().mockResolvedValue([]);
    prisma.part.findFirst.mockReset().mockResolvedValue(null);
    links.candidatesForItems.mockReset();
    links.lookupLive.mockReset();
    invoices.linkItemFromCatalog.mockReset().mockResolvedValue(undefined);
    invoices.createPartFromItem.mockReset().mockResolvedValue({});
  });

  it('nota inexistente é 404; nota já lançada não é tocada', async () => {
    prisma.purchaseInvoice.findUnique.mockResolvedValueOnce(null);
    await expect(svc.matchInvoice(CALLER, 'c', 'x')).rejects.toBeInstanceOf(NotFoundException);
    prisma.purchaseInvoice.findUnique.mockResolvedValueOnce({ id: 'inv', status: 'FULL', exportStatus: 'POSTED' });
    expect(await svc.matchInvoice(CALLER, 'c', 'inv')).toEqual({ resolved: 0, created: 0, unresolved: 0 });
    expect(links.candidatesForItems).not.toHaveBeenCalled();
  });

  it('cria a peça já vinculada ao catálogo quando a oficina ainda não a tem', async () => {
    links.candidatesForItems.mockResolvedValue(new Map([['i1', { catalogSku: 'S1', via: 'PART_NUMBER' }]]));
    links.lookupLive.mockResolvedValue({ items: new Map([['S1', ref('S1')]]) });
    const report = await svc.matchInvoice(CALLER, 'c', 'inv');
    expect(invoices.createPartFromItem).toHaveBeenCalledWith('inv', 1, expect.objectContaining({ catalogSku: 'S1', sellPrice: 0, unitFactor: 1 }), ref('S1'), 'AUTO_CATALOG');
    expect(report).toEqual({ resolved: 1, created: 1, unresolved: 1 });
  });

  it('liga ao cadastro que a oficina já tem daquela peça do catálogo', async () => {
    links.candidatesForItems.mockResolvedValue(new Map([['i1', { catalogSku: 'S1', via: 'GTIN' }]]));
    links.lookupLive.mockResolvedValue({ items: new Map([['S1', ref('S1')]]) });
    prisma.part.findMany.mockResolvedValue([{ id: 'p1', catalogSku: 'S1', unit: 'PC' }]);
    const report = await svc.matchInvoice(CALLER, 'c', 'inv');
    expect(invoices.linkItemFromCatalog).toHaveBeenCalledWith('inv', 1, 'p1');
    expect(invoices.createPartFromItem).not.toHaveBeenCalled();
    expect(report).toEqual({ resolved: 1, created: 0, unresolved: 1 });
  });

  it('unidade diferente da do estoque fica para a pessoa (precisa de fator)', async () => {
    links.candidatesForItems.mockResolvedValue(new Map([['i1', { catalogSku: 'S1', via: 'GTIN' }]]));
    links.lookupLive.mockResolvedValue({ items: new Map([['S1', ref('S1')]]) });
    prisma.part.findMany.mockResolvedValue([{ id: 'p1', catalogSku: 'S1', unit: 'CX' }]);
    expect(await svc.matchInvoice(CALLER, 'c', 'inv')).toEqual({ resolved: 0, created: 0, unresolved: 2 });
    expect(invoices.linkItemFromCatalog).not.toHaveBeenCalled();
  });

  it('peça retirada do catálogo não casa; sem candidato nada é gravado', async () => {
    links.candidatesForItems.mockResolvedValue(new Map([['i1', { catalogSku: 'S1', via: 'GTIN' }]]));
    links.lookupLive.mockResolvedValue({ items: new Map() });
    expect(await svc.matchInvoice(CALLER, 'c', 'inv')).toEqual({ resolved: 0, created: 0, unresolved: 2 });
    links.candidatesForItems.mockResolvedValue(new Map());
    expect(await svc.matchInvoice(CALLER, 'c', 'inv')).toEqual({ resolved: 0, created: 0, unresolved: 2 });
  });

  it('um item que falha não derruba os outros', async () => {
    links.candidatesForItems.mockResolvedValue(
      new Map([
        ['i1', { catalogSku: 'S1', via: 'GTIN' }],
        ['i2', { catalogSku: 'S2', via: 'GTIN' }],
      ]),
    );
    links.lookupLive.mockResolvedValue({ items: new Map([['S1', ref('S1')], ['S2', ref('S2')]]) });
    invoices.createPartFromItem.mockRejectedValueOnce(new Error('Já existe uma peça com este SKU')).mockResolvedValueOnce({});
    expect(await svc.matchInvoice(CALLER, 'c', 'inv')).toEqual({ resolved: 1, created: 1, unresolved: 1 });
  });
});
