import { Prisma } from '@fixer/db';
import { describe, expect, it } from 'vitest';
import { buildEntrySnapshot, canonicalJson, ENTRY_SNAPSHOT_SCHEMA_VERSION, hashContext, type SnapshotInput } from './entry-snapshot.js';

const D = (v: string) => new Prisma.Decimal(v);

function input(over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    invoice: {
      accessKey: '2626', number: 123, series: 1, issuedAt: new Date('2026-10-18T12:00:00Z'), issuerCnpj: '11222333000181',
      issuerName: 'Fornecedor', issuerUf: 'SP', issuerCrt: 3, recipientUf: 'PE', destIndicator: 2, freightMode: 0,
    },
    item: {
      id: 'it1', itemNumber: 2, supplierCode: 'PAST-001', description: 'Pastilha', ncm: '68138110', cest: '0101400', origin: 0,
      cfop: '6102', unit: 'JG', quantity: D('10'), unitFactor: D('1'), unitPrice: D('20'), totalPrice: D('200'),
    },
    part: {
      id: 'p1', sku: 'PAST', name: 'Pastilha', ncm: '68138110', cest: null, pricingMode: 'AUTO', icmsStStatus: 'UNKNOWN',
      pisCofinsMonofasico: null, taxFlagsSource: null, fiscalVerified: false,
    },
    before: { stockQty: D('5'), costPrice: D('10'), avgCost: null, sellPrice: D('40') },
    after: { stockQty: D('15'), costPrice: D('23.2'), avgCost: D('18.8'), sellPrice: D('43.9') },
    quantity: D('10'),
    ledger: { regime: 'SIMPLES', rulesVersion: 'v1', alerts: [{ code: 'FRETE_POR_FORA', severity: 'warning', message: 'm', itemNumbers: [] }] },
    itemLedger: {
      itemNumber: 2, totalCost: D('232'), stockQty: D('10'), landedCost: D('23.2'), profile: 'RESALE',
      components: [{ code: 'PRODUTO', treatment: 'COST', amount: D('200'), source: 'vProd', allocated: false }],
    },
    plan: { rulesVersion: 'v1' },
    row: null,
    planError: null,
    applyPricing: true,
    priceHistoryId: 'h1',
    fiscal: { taxRegime: 'SIMPLES', ufCode: 26, profile: null, tableReviews: [] },
    postedAt: new Date('2026-10-19T10:00:00Z'),
    postedById: 'u1',
    ...over,
  } as SnapshotInput;
}

describe('canonicalJson / hashContext', () => {
  it('a ordem das chaves não muda o texto nem o hash', () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } };
    const b = { a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hashContext(a)).toBe(hashContext(b));
  });

  it('qualquer valor diferente muda o hash', () => {
    expect(hashContext({ a: '1.0' })).not.toBe(hashContext({ a: '1' }));
  });
});

describe('buildEntrySnapshot', () => {
  it('guarda documento, estoque antes e depois, custo e versões, tudo em string', () => {
    const { context, contentHash } = buildEntrySnapshot(input());
    expect(context).toMatchObject({
      schemaVersion: ENTRY_SNAPSHOT_SCHEMA_VERSION,
      document: { accessKey: '2626', issuer: { uf: 'SP', crt: 3 }, recipientUf: 'PE', issuedAt: '2026-10-18T12:00:00.000Z' },
      stock: { quantity: '10', before: { stockQty: '5', avgCost: null }, after: { avgCost: '18.8' } },
      cost: { unit: '23.2', total: '232', regime: 'SIMPLES', components: [{ code: 'PRODUTO', amount: '200' }] },
      price: { outcome: 'APPLIED', before: '40', after: '43.9', priceHistoryId: 'h1' },
      engines: { taxRulesVersion: 'v1', rulesetVersion: null, costProfileVersion: null },
    });
    // alerta da nota inteira entra no item
    expect((context.cost as { alerts: unknown[] }).alerts).toHaveLength(1);
    expect(contentHash).toBe(hashContext(context));
  });

  it('o hash sobrevive a ida e volta pelo JSON (o JSONB do Postgres reordena chaves)', () => {
    const { context, contentHash } = buildEntrySnapshot(input());
    const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(context)) as object).reverse());
    expect(hashContext(reordered)).toBe(contentHash);
  });

  it('distingue preço não pedido, sem mudança e peça travada', () => {
    expect(buildEntrySnapshot(input({ applyPricing: false, after: { ...input().after, sellPrice: D('40') } })).context.price).toMatchObject({ outcome: 'NOT_REQUESTED' });
    const same = buildEntrySnapshot(input({ after: { ...input().after, sellPrice: D('40') } }));
    expect(same.priceChanged).toBe(false);
    expect(same.context.price).toMatchObject({ outcome: 'UNCHANGED' });
    const locked = buildEntrySnapshot(input({ part: { ...input().part, pricingMode: 'MANUAL' } }));
    expect(locked.context.price).toMatchObject({ outcome: 'LOCKED' });
    expect(locked.priceChanged).toBe(false);
  });

  it('sem plano de preço registra o motivo em vez de falhar', () => {
    const { context } = buildEntrySnapshot(input({ plan: null, planError: 'perfil incompleto', applyPricing: false }));
    expect(context.price).toMatchObject({ error: 'perfil incompleto', rule: null });
    expect(context.saleTax).toBeNull();
    expect(context.engines).toMatchObject({ taxRulesVersion: 'v1' });
  });
});
