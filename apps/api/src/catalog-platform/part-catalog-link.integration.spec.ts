import type { PrismaClient } from '@fixer/db';
import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tenantClient } from '../../test/db.js';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { OTHER_ORG, TEST_ORG } from '../../test/setup.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import type { CallerContext } from './catalog-platform.service.js';
import { PartCatalogLinkService } from './part-catalog-link.service.js';

/**
 * Vínculo peça × catálogo contra Postgres REAL, conectando como `fixer_rls` (o papel da API, sujeito a RLS). Prova o que o código assume do banco:
 * unicidade do vínculo POR oficina, o CHECK que mantém os três campos juntos e o formato do erro de unicidade que o serviço traduz em 409.
 * Só roda com FISCAL_TEST_DATABASE_URL (banco descartável, já migrado).
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const A = TEST_ORG;
const B = OTHER_ORG;
const caller: CallerContext = { token: 'user-jwt', orgId: A };
const CATALOG = 'rocket-autopecas';
const now = () => new Date();

describe.skipIf(!URL)('Vínculo da peça com o catálogo (Postgres)', () => {
  let db: PrismaClient;
  let release: () => Promise<void>;
  const inOrg = <T>(org: string, fn: () => Promise<T>) => TenantContext.run(org, fn);

  const platform = { lookupParts: vi.fn(), lookupBarcodes: vi.fn() };
  const service = () => new PartCatalogLinkService(db as unknown as PrismaService, platform as never);

  const part = (sku: string, extra: Record<string, unknown> = {}) => ({ sku, name: `Peça ${sku}`, costPrice: 1, sellPrice: 2, ...extra });
  const linked = (catalogSku: string) => ({ catalogSku, catalogLinkedAt: now(), catalogLinkSource: 'MANUAL' as const });

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    db = tenantClient(URL!);
  });
  afterAll(async () => {
    await db?.$disconnect();
    await release?.();
  });
  beforeEach(async () => {
    for (const org of [A, B]) await inOrg(org, () => db.part.deleteMany());
    platform.lookupParts.mockReset();
    platform.lookupBarcodes.mockReset();
  });

  describe('o banco', () => {
    it('o vínculo é único por oficina (erro P2002), e o Prisma NÃO diz qual campo violou: por isso o serviço descobre a causa olhando o banco', async () => {
      await inOrg(A, () => db.part.create({ data: part('a1', linked('cat-1')) }));
      const err = await inOrg(A, () => db.part.create({ data: part('a2', linked('cat-1')) })).catch((e: unknown) => e);
      expect((err as { code?: string }).code).toBe('P2002');
      // Com o cliente de tenant da API, `meta.target` chega nulo (visto neste teste). Se o Prisma passar a informar, o serviço continua certo: ele nunca depende disso.
    });

    it('a mesma peça do catálogo pode estar em oficinas diferentes', async () => {
      await inOrg(A, () => db.part.create({ data: part('a1', linked('cat-1')) }));
      await expect(inOrg(B, () => db.part.create({ data: part('b1', linked('cat-1')) }))).resolves.toBeTruthy();
    });

    it('várias peças só da oficina (sem vínculo) convivem: NULL não conflita', async () => {
      await inOrg(A, () => db.part.create({ data: part('l1') }));
      await expect(inOrg(A, () => db.part.create({ data: part('l2') }))).resolves.toBeTruthy();
    });

    it('os três campos do vínculo andam juntos: vínculo pela metade é recusado pelo banco', async () => {
      await expect(inOrg(A, () => db.part.create({ data: part('x1', { catalogSku: 'cat-9' }) }))).rejects.toThrow();
      await expect(inOrg(A, () => db.part.create({ data: part('x2', { catalogLinkSource: 'MANUAL' }) }))).rejects.toThrow();
      await expect(inOrg(A, () => db.part.create({ data: part('x3', { catalogSku: 'cat-9', catalogLinkedAt: now() }) }))).rejects.toThrow();
    });

    it('isolamento: uma oficina não enxerga nem altera o vínculo da outra', async () => {
      await inOrg(A, () => db.part.create({ data: part('a1', linked('cat-1')) }));
      expect(await inOrg(B, () => db.part.findMany())).toHaveLength(0);
      expect(await inOrg(B, () => db.part.updateMany({ data: { name: 'invadida' } }))).toEqual({ count: 0 });
    });
  });

  describe('o serviço sobre o banco real', () => {
    const live = (sku: string, over: Record<string, unknown> = {}) => ({
      sku,
      name: `Catálogo ${sku}`,
      partNumber: `PN-${sku}`,
      barcodes: [],
      active: true,
      retired: false,
      etag: 'a'.repeat(32),
      ...over,
    });

    it('createFromCatalog grava a peça com o vínculo; repetir a mesma peça do catálogo é 409 com a mensagem certa', async () => {
      platform.lookupParts.mockResolvedValue({ items: [live('cat-1', { barcodes: ['7891234567890'] })], missing: [] });
      const created = await inOrg(A, () => service().createFromCatalog(caller, CATALOG, { catalogSku: 'cat-1', costPrice: 10, sellPrice: 20 }));
      expect(created).toMatchObject({ sku: 'PN-cat-1', name: 'Catálogo cat-1', ean: '7891234567890', catalogSku: 'cat-1', catalogLinkSource: 'CREATED_FROM_CATALOG' });

      const again = await inOrg(A, () => service().createFromCatalog(caller, CATALOG, { catalogSku: 'cat-1', sku: 'OUTRO', costPrice: 1, sellPrice: 1 })).catch((e: unknown) => e);
      expect(again).toBeInstanceOf(ConflictException);
      expect((again as Error).message).toMatch(/já está no estoque/);
    });

    it('SKU interno repetido é 409 com a mensagem do SKU (não a do catálogo)', async () => {
      platform.lookupParts.mockResolvedValue({ items: [live('cat-2')], missing: [] });
      await inOrg(A, () => db.part.create({ data: part('PN-cat-2') }));
      const e = await inOrg(A, () => service().createFromCatalog(caller, CATALOG, { catalogSku: 'cat-2', costPrice: 1, sellPrice: 1 })).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ConflictException);
      expect((e as Error).message).toMatch(/SKU/);
    });

    it('link e unlink: o vínculo nasce MANUAL e some inteiro; link repetido é 409', async () => {
      platform.lookupParts.mockResolvedValue({ items: [live('cat-3')], missing: [] });
      const p = await inOrg(A, () => db.part.create({ data: part('l1') }));
      await inOrg(A, () => service().link(caller, CATALOG, p.id, 'cat-3'));
      expect(await inOrg(A, () => db.part.findUnique({ where: { id: p.id } }))).toMatchObject({ catalogSku: 'cat-3', catalogLinkSource: 'MANUAL', catalogLinkedAt: expect.any(Date) });
      await expect(inOrg(A, () => service().link(caller, CATALOG, p.id, 'cat-4'))).rejects.toBeInstanceOf(ConflictException);

      await inOrg(A, () => service().unlink(p.id));
      expect(await inOrg(A, () => db.part.findUnique({ where: { id: p.id } }))).toMatchObject({ catalogSku: null, catalogLinkedAt: null, catalogLinkSource: null });
    });

    it('vínculo em lote pelo GTIN: grava só o vinculável, deixa conflito e ambiguidade, e nunca toca a outra oficina', async () => {
      const mk = (sku: string, ean: string, extra: Record<string, unknown> = {}) => db.part.create({ data: part(sku, { ean, ...extra }) });
      const ok = await inOrg(A, () => mk('ok', '7891111111111'));
      const dupA = await inOrg(A, () => mk('dupA', '7892222222222'));
      const dupB = await inOrg(A, () => mk('dupB', '7892222222222'));
      const taken = await inOrg(A, () => mk('taken', '7893333333333'));
      await inOrg(A, () => mk('holder', '7899999999999', linked('cat-3')));
      const none = await inOrg(A, () => mk('none', '7894444444444'));
      const other = await inOrg(B, () => mk('b-ok', '7891111111111'));
      platform.lookupBarcodes.mockResolvedValue({
        matches: [
          { barcode: '7891111111111', skus: ['cat-1'] },
          { barcode: '7892222222222', skus: ['cat-2'] },
          { barcode: '7893333333333', skus: ['cat-3'] },
          { barcode: '7894444444444', skus: [] },
        ],
      });

      const report = await inOrg(A, () => service().linkByBarcode(caller, CATALOG, { apply: true }));
      expect(report.summary).toEqual({ linkable: 1, ambiguousCatalog: 0, ambiguousLocal: 2, conflict: 1, noMatch: 1, linked: 1 });

      const after = async (org: string, id: string) => inOrg(org, () => db.part.findUnique({ where: { id }, select: { catalogSku: true, catalogLinkSource: true } }));
      expect(await after(A, ok.id)).toEqual({ catalogSku: 'cat-1', catalogLinkSource: 'EAN' });
      for (const p of [dupA, dupB, taken, none]) expect((await after(A, p.id))?.catalogSku).toBeNull();
      expect((await after(B, other.id))?.catalogSku).toBeNull(); // outra oficina: intacta
    });

    it('sem apply, o lote só relata e não grava', async () => {
      const p = await inOrg(A, () => db.part.create({ data: part('ok', { ean: '7891111111111' }) }));
      platform.lookupBarcodes.mockResolvedValue({ matches: [{ barcode: '7891111111111', skus: ['cat-1'] }] });
      const report = await inOrg(A, () => service().linkByBarcode(caller, CATALOG, { apply: false }));
      expect(report.summary).toMatchObject({ linkable: 1, linked: 0 });
      expect((await inOrg(A, () => db.part.findUnique({ where: { id: p.id } })))?.catalogSku).toBeNull();
    });
  });
});
