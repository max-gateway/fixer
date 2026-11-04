import { describe, expect, it, vi } from 'vitest';
import type { CallerContext } from './catalog-platform.service.js';
import { FiscalObservationsService, OBSERVATIONS_PER_CALL } from './fiscal-observations.service.js';

const ISSUED = new Date('2026-10-20T13:00:00Z');
const KEY = '35261012345678000195550010000012341000012345';
const caller: CallerContext = { token: 'user-jwt', orgId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' };

const item = (over: Record<string, unknown> = {}) => ({ ncm: '68138110', cest: null, origin: 0, unit: 'PC', part: { catalogSku: 'sku-1' }, ...over });
const invoice = (items: unknown[], over: Record<string, unknown> = {}) => ({ accessKey: KEY, issuerCnpj: '12345678000195', issuedAt: ISSUED, postedAt: null, items, ...over }) as never;

describe('FiscalObservationsService.itemsOf (o que vai à plataforma)', () => {
  it('uma observação por peça VINCULADA ao catálogo, com a chave da nota, o emitente e a data de emissão', () => {
    const out = FiscalObservationsService.itemsOf(invoice([item({ cest: '01.014.00', origin: 1, unit: ' pc ' }), item({ part: { catalogSku: null } }), item({ part: null })]));
    expect(out).toEqual([{ sku: 'sku-1', accessKey: KEY, issuerCnpj: '12345678000195', observedAt: '2026-10-20T13:00:00.000Z', source: 'NFE_XML', ncm: '68138110', cest: '0101400', origin: 1, unit: 'PC' }]);
  });

  it('duas linhas da nota para a mesma peça do catálogo valem uma observação', () => {
    expect(FiscalObservationsService.itemsOf(invoice([item(), item({ ncm: '68138190' })]))).toHaveLength(1);
    expect(FiscalObservationsService.itemsOf(invoice([item(), item({ part: { catalogSku: 'sku-2' } })]))).toHaveLength(2);
  });

  it('descarta o que a plataforma recusaria: NCM que não tem 8 dígitos; CEST, origem e unidade inválidos só são omitidos', () => {
    expect(FiscalObservationsService.itemsOf(invoice([item({ ncm: '0' }), item({ ncm: '' , part: { catalogSku: 'x' } })]))).toEqual([]);
    const [o] = FiscalObservationsService.itemsOf(invoice([item({ cest: '12', origin: 9, unit: 'MUITOLONGA' })]));
    expect(o).not.toHaveProperty('cest');
    expect(o).not.toHaveProperty('origin');
    expect(o).not.toHaveProperty('unit');
    expect(o?.ncm).toBe('68138110');
  });

  it('origem 0 (nacional) é enviada', () => {
    expect(FiscalObservationsService.itemsOf(invoice([item({ origin: 0 })]))[0]).toMatchObject({ origin: 0 });
  });

  it('emitente CPF (produtor rural) não gera observação; CNPJ alfanumérico e pontuado são aceitos', () => {
    expect(FiscalObservationsService.itemsOf(invoice([item()], { issuerCnpj: '12345678901' }))).toEqual([]);
    expect(FiscalObservationsService.itemsOf(invoice([item()], { issuerCnpj: '12.abc.345/01de-35' }))[0]).toMatchObject({ issuerCnpj: '12ABC34501DE35' });
  });

  it('sem data de emissão usa a do lançamento', () => {
    const posted = new Date('2026-10-21T08:00:00Z');
    expect(FiscalObservationsService.itemsOf(invoice([item()], { issuedAt: null, postedAt: posted }))[0]?.observedAt).toBe(posted.toISOString());
  });
});

describe('FiscalObservationsService.emit', () => {
  const build = (inv: unknown) => {
    const findUnique = vi.fn(async () => inv);
    const fiscalObservations = vi.fn(async () => ({ accepted: 1, duplicates: 0, rejected: [] }));
    const service = new FiscalObservationsService({ purchaseInvoice: { findUnique } } as never, { fiscalObservations } as never);
    return { service, findUnique, fiscalObservations };
  };

  it('lê só os itens vinculados e envia com chave de idempotência por nota', async () => {
    const { service, findUnique, fiscalObservations } = build(invoice([item()]));
    expect(await service.emit(caller, 'inv-1')).toEqual({ sent: 1 });
    expect((findUnique.mock.calls[0] as unknown as [{ select: { items: { where: unknown } } }])[0].select.items.where).toEqual({ partId: { not: null } });
    const call = fiscalObservations.mock.calls[0] as unknown as [CallerContext, unknown[], string];
    expect(call[0]).toBe(caller);
    expect(call[2]).toBe('fixer-invoice-inv-1-0');
  });

  it('nota inexistente ou sem peça do catálogo não chama a plataforma', async () => {
    const a = build(null);
    expect(await a.service.emit(caller, 'x')).toEqual({ sent: 0 });
    const b = build(invoice([item({ part: { catalogSku: null } })]));
    expect(await b.service.emit(caller, 'x')).toEqual({ sent: 0 });
    expect(a.fiscalObservations).not.toHaveBeenCalled();
    expect(b.fiscalObservations).not.toHaveBeenCalled();
  });

  it('divide em chamadas de até 500, cada uma com a própria chave de idempotência', async () => {
    const many = Array.from({ length: OBSERVATIONS_PER_CALL + 3 }, (_, i) => item({ part: { catalogSku: `sku-${i}` } }));
    const { service, fiscalObservations } = build(invoice(many));
    expect(await service.emit(caller, 'inv-9')).toEqual({ sent: OBSERVATIONS_PER_CALL + 3 });
    const calls = fiscalObservations.mock.calls as unknown as Array<[CallerContext, unknown[], string]>;
    expect(calls.map((c) => [c[1].length, c[2]])).toEqual([[500, 'fixer-invoice-inv-9-0'], [3, 'fixer-invoice-inv-9-1']]);
  });
});

describe('FiscalObservationsService.emitInBackground: nunca atrapalha o lançamento', () => {
  const settle = () => new Promise((r) => setTimeout(r, 10));

  it('falha da plataforma é engolida (e registrada), nunca lançada', async () => {
    const service = new FiscalObservationsService({ purchaseInvoice: { findUnique: async () => invoice([item()]) } } as never, { fiscalObservations: async () => { throw new Error('plataforma fora'); } } as never);
    expect(() => service.emitInBackground(() => caller, 'inv-1')).not.toThrow();
    await settle();
  });

  it('não montar o contexto da chamada (sem token) também é engolido e nada é enviado', async () => {
    const platform = { fiscalObservations: vi.fn() };
    const service = new FiscalObservationsService({ purchaseInvoice: { findUnique: async () => invoice([item()]) } } as never, platform as never);
    expect(() => service.emitInBackground(() => { throw new Error('Token ausente'); }, 'inv-1')).not.toThrow();
    await settle();
    expect(platform.fiscalObservations).not.toHaveBeenCalled();
  });

  it('sem PARTS_SEARCH_URL não há para quem enviar: nem lê a nota', async () => {
    const findUnique = vi.fn();
    const service = new FiscalObservationsService({ purchaseInvoice: { findUnique } } as never, {} as never, { baseUrl: '' } as never);
    service.emitInBackground(() => caller, 'inv-1');
    await settle();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('envia quando tudo está configurado', async () => {
    const platform = { fiscalObservations: vi.fn(async () => ({})) };
    const service = new FiscalObservationsService({ purchaseInvoice: { findUnique: async () => invoice([item()]) } } as never, platform as never, { baseUrl: 'https://catalog.example' } as never);
    service.emitInBackground(() => caller, 'inv-1');
    await settle();
    expect(platform.fiscalObservations).toHaveBeenCalledTimes(1);
  });
});
