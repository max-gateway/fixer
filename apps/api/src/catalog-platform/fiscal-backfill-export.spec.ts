import { describe, expect, it, vi } from 'vitest';
import { FiscalBackfillController, FiscalBackfillExport } from './fiscal-backfill-export.js';

const part = (over: Record<string, unknown> = {}) => ({ catalogSku: 'cat-1', ncm: '6813.81.10', cest: '01.014.00', originCode: 0, unit: ' pc ', fiscalVerified: true, ...over }) as never;
const ORG = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

describe('FiscalBackfillExport.lineOf (peça da oficina → linha do CLI da plataforma)', () => {
  it('leva o dado fiscal normalizado, o sku DO CATÁLOGO e o aceite do contador', () => {
    expect(FiscalBackfillExport.lineOf(part(), 's1')).toEqual({ storeId: 's1', sku: 'cat-1', ncm: '68138110', cest: '0101400', origin: 0, unit: 'PC', verified: true });
  });

  it('peça NÃO casada ao catálogo fica de fora (segue o fluxo de proposta de inserção)', () => {
    expect(FiscalBackfillExport.lineOf(part({ catalogSku: null }), 's1')).toBeNull();
  });

  it('peça casada sem nenhum dado fiscal aproveitável fica de fora', () => {
    expect(FiscalBackfillExport.lineOf(part({ ncm: null, cest: null, originCode: null, unit: null }), 's1')).toBeNull();
    expect(FiscalBackfillExport.lineOf(part({ ncm: '12', cest: '1', originCode: 9, unit: 'MUITOLONGA' }), 's1')).toBeNull();
  });

  it('campo inválido é omitido sem derrubar a linha; origem 0 é enviada', () => {
    const l = FiscalBackfillExport.lineOf(part({ cest: '12', unit: null, originCode: 0 }), 's1')!;
    expect(l).not.toHaveProperty('cest');
    expect(l).not.toHaveProperty('unit');
    expect(l.origin).toBe(0);
  });

  it('nunca leva o que a plataforma não guarda: custo, margem, fornecedor, CFOP, CST, CSOSN', () => {
    const l = FiscalBackfillExport.lineOf(part({ costPrice: 10, sellPrice: 20, supplierName: 'X', defaultCfop: '5102', csosn: '102', cst: '00' }), 's1')!;
    expect(Object.keys(l).sort()).toEqual(['cest', 'ncm', 'origin', 'sku', 'storeId', 'unit', 'verified']);
  });
});

describe('FiscalBackfillExport.ndjson', () => {
  const build = (pages: unknown[][]) => {
    const findMany = vi.fn(async () => pages.shift() ?? []);
    return { exporter: new FiscalBackfillExport({ part: { findMany } } as never), findMany };
  };

  it('uma linha por peça, a loja é a organização em minúsculas, e só as peças casadas são consultadas', async () => {
    const { exporter, findMany } = build([[{ id: 'a', ...(part() as object) }, { id: 'b', ...(part({ ncm: null, cest: null, originCode: null, unit: null }) as object) }]]);
    const out = await exporter.ndjson(ORG);
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([{ storeId: ORG.toLowerCase(), sku: 'cat-1', ncm: '68138110', cest: '0101400', origin: 0, unit: 'PC', verified: true }]);
    expect((findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ catalogSku: { not: null } });
  });

  it('pagina por id sem perder nem repetir peça', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}`, ...(part({ catalogSku: `c${i}` }) as object) }));
    const { exporter, findMany } = build([full, [{ id: 'p9999', ...(part({ catalogSku: 'ultima' }) as object) }]]);
    const lines = (await exporter.ndjson(ORG)).trim().split('\n');
    expect(lines).toHaveLength(1001);
    expect((findMany.mock.calls[1] as unknown as [{ where: { id: { gt: string } } }])[0].where.id).toEqual({ gt: 'p0999' });
  });

  it('sem peças a levar devolve vazio', async () => {
    expect(await build([[]]).exporter.ndjson(ORG)).toBe('');
  });
});

describe('FiscalBackfillController', () => {
  it('usa a organização do Principal e recusa sem ela', () => {
    const exporter = { ndjson: vi.fn(async () => 'x') };
    const c = new FiscalBackfillController(exporter as never);
    void c.export({ principal: { tenantId: ORG } });
    expect(exporter.ndjson).toHaveBeenCalledWith(ORG);
    expect(() => c.export({})).toThrow(/Organização/);
  });
});
