import { PrismaClient } from '@fixer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantClient } from '../../test/db.js';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { addDaysIso, civil, todayIso } from './dates.js';
import { PayablesService, ListQuerySchema } from './payables.service.js';

/**
 * Contas a pagar contra Postgres REAL (RLS ligada): criação parcelada, pagamento com juros/desconto, guardas de estado,
 * lote, filtros, resumo, previsão e CSV. Só roda com FISCAL_TEST_DATABASE_URL (banco descartável).
 */
const URL = process.env.FISCAL_TEST_DATABASE_URL;
const USER = 'itest-payables-user';
const actor = { id: USER, name: 'Maria Teste' };
const list = (q: Record<string, unknown> = {}) => ListQuerySchema.parse(q);

describe.skipIf(!URL)('PayablesService (Postgres, integração)', () => {
  let db: PrismaClient;
  let service: PayablesService;
  let release: () => Promise<void>;
  const today = todayIso();

  const cleanup = async () => {
    await db.payableEvent.deleteMany();
    await db.payable.deleteMany();
    await db.user.deleteMany({ where: { id: USER } });
  };

  /** Conta com vencimento relativo a hoje, direto no banco (como se viesse do XML, quando `source` é XML). */
  const seed = (o: { days: number; amount: string; supplier?: string; source?: 'MANUAL' | 'XML_INSTALLMENT'; category?: string; status?: 'OPEN' | 'PAID' }) =>
    db.payable.create({
      data: {
        source: o.source ?? 'MANUAL',
        supplierName: o.supplier ?? 'ITEST Fornecedor A',
        category: o.category ?? null,
        dueDate: civil(addDaysIso(today, o.days)),
        amount: o.amount,
        status: o.status ?? 'OPEN',
        ...(o.status === 'PAID' ? { paidAt: civil(today), paidAmount: o.amount, paidById: USER } : {}),
      },
    });

  beforeAll(async () => {
    release = await acquireDbLock(URL!);
    db = tenantClient(URL!);
    service = new PayablesService(db as never);
  }, 60_000);
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
    await release();
  }, 60_000);
  beforeEach(async () => {
    await cleanup();
    await db.user.create({ data: { id: USER, keycloakId: USER, name: 'Maria Teste', email: 'itest-payables@x.test' } });
  });

  it('cria parcelas mensais que fecham o total, cada uma com evento de auditoria', async () => {
    const created = await service.create({ supplierName: 'ITEST Aluguel', dueDate: '2026-01-31', amount: 100, installments: 3, category: 'Aluguel' } as never, actor);
    expect(created.map((p) => p.amount.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(created.map((p) => p.dueDate.toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(created.map((p) => `${p.installment}/${p.installmentCount}`)).toEqual(['1/3', '2/3', '3/3']);
    expect(await db.payableEvent.count({ where: { type: 'CREATED', actorName: 'Maria Teste' } })).toBe(3);
  });

  it('paga com juros e desconto, guarda quem pagou, e não paga duas vezes', async () => {
    const p = await seed({ days: -2, amount: '200.00' });
    const paid = await service.pay(p.id, { interest: 12.5, discount: 2.5, method: 'PIX', paidAt: today }, actor);
    expect(paid).toMatchObject({ status: 'PAID', paymentMethod: 'PIX', paidById: USER });
    expect(paid.paidAmount!.toFixed(2)).toBe('210.00');
    expect(paid.interest!.toFixed(2)).toBe('12.50');
    expect(paid.events.map((e) => e.type)).toEqual(['PAID']);
    await expect(service.pay(p.id, {}, actor)).rejects.toThrow(/já foi paga/);
    await expect(service.cancel(p.id, actor)).rejects.toThrow(/em aberto/);
  });

  it('desconto que zera a conta é recusado; sem ajustes paga o valor cheio', async () => {
    const p = await seed({ days: 1, amount: '50.00' });
    await expect(service.pay(p.id, { discount: 50 }, actor)).rejects.toThrow(/desconto/i);
    expect((await service.pay(p.id, {}, actor)).paidAmount!.toFixed(2)).toBe('50.00');
  });

  it('desfaz pagamento (limpa juros e forma) e registra o estorno', async () => {
    const p = await seed({ days: 0, amount: '80.00' });
    await service.pay(p.id, { interest: 1, method: 'BOLETO' }, actor);
    const back = await service.unpay(p.id, actor);
    expect(back).toMatchObject({ status: 'OPEN', paidAt: null, paidAmount: null, interest: null, paymentMethod: null, paidById: null });
    expect(back.events.map((e) => e.type)).toEqual(['UNPAID', 'PAID']);
    await expect(service.unpay(p.id, actor)).rejects.toThrow(/não está paga/);
  });

  it('edição registra o antes e o depois; só conta em aberto; fornecedor de NF-e é travado', async () => {
    const p = await seed({ days: 5, amount: '10.00' });
    const edited = await service.update(p.id, { amount: 12, category: 'Impostos e taxas', notes: 'negociado' }, actor);
    expect(edited.amount.toFixed(2)).toBe('12.00');
    const ev = edited.events.find((e) => e.type === 'EDITED')!;
    expect(ev.data).toMatchObject({ amount: { from: '10.00', to: '12.00' }, category: { from: null, to: 'Impostos e taxas' } });
    // sem mudança real não gera evento
    await service.update(p.id, { amount: 12 }, actor);
    expect((await service.get(p.id)).events.filter((e) => e.type === 'EDITED')).toHaveLength(1);

    const xml = await seed({ days: 5, amount: '10.00', source: 'XML_INSTALLMENT' });
    await expect(service.update(xml.id, { supplierName: 'Outro' }, actor)).rejects.toThrow(/vem do XML/);
    await service.pay(p.id, {}, actor);
    await expect(service.update(p.id, { amount: 1 }, actor)).rejects.toThrow(/em aberto/);
  });

  it('lote: paga as abertas e devolve o resto em skipped; desfaz e cancela em lote', async () => {
    const a = await seed({ days: 1, amount: '10.00' });
    const b = await seed({ days: 2, amount: '20.00' });
    const done = await seed({ days: 3, amount: '30.00', status: 'PAID' });
    const r = await service.bulk({ ids: [a.id, b.id, done.id, 'nao-existe'], action: 'pay', method: 'PIX' }, actor);
    expect(r.done.sort()).toEqual([a.id, b.id].sort());
    expect(r.skipped.sort()).toEqual([done.id, 'nao-existe'].sort());
    expect(await db.payableEvent.count({ where: { type: 'PAID' } })).toBe(2);

    expect((await service.bulk({ ids: [a.id, b.id], action: 'unpay' }, actor)).done).toHaveLength(2);
    expect((await service.bulk({ ids: [a.id], action: 'cancel' }, actor)).done).toEqual([a.id]);
    expect((await service.bulk({ ids: [a.id], action: 'cancel' }, actor)).skipped).toEqual([a.id]);
  });

  it('abas por data (vencida / 7 dias), filtros, ordenação e total do filtro', async () => {
    await seed({ days: -3, amount: '100.00', supplier: 'ITEST Peças SA', category: 'Compras', source: 'XML_INSTALLMENT' });
    await seed({ days: 0, amount: '50.00', supplier: 'ITEST Peças SA', category: 'Compras', source: 'XML_INSTALLMENT' });
    await seed({ days: 7, amount: '25.00', supplier: 'ITEST Energia', category: 'Energia, água e internet' });
    await seed({ days: 8, amount: '5.00', supplier: 'ITEST Energia' });

    expect((await service.list(list({ view: 'overdue' }))).items).toHaveLength(1);
    expect((await service.list(list({ view: 'week' }))).items.map((i) => i.amount.toFixed(2))).toEqual(['50.00', '25.00']);
    const open = await service.list(list({ view: 'open', sort: 'amount', dir: 'desc' }));
    expect(open.items.map((i) => i.amount.toFixed(2))).toEqual(['100.00', '50.00', '25.00', '5.00']);
    expect(open.totalAmount).toBe('180.00');

    expect((await service.list(list({ supplier: 'itest peças sa' }))).total).toBe(2);
    expect((await service.list(list({ category: 'Compras' }))).total).toBe(2);
    expect((await service.list(list({ source: 'nfe' }))).total).toBe(2);
    expect((await service.list(list({ source: 'manual' }))).total).toBe(2);
    expect((await service.list(list({ from: addDaysIso(today, 1), to: addDaysIso(today, 7) }))).total).toBe(1);
    expect((await service.list(list({ q: 'energia' }))).total).toBe(2);
    expect((await service.list(list({ sort: 'supplier' }))).items[0]!.supplierName).toBe('ITEST Energia');
  });

  it('resumo por aba e pago no mês; previsão por janela', async () => {
    await seed({ days: -1, amount: '10.00' });
    await seed({ days: 2, amount: '20.00' });
    await seed({ days: 20, amount: '30.00' });
    await seed({ days: 0, amount: '99.00', status: 'PAID' });
    const s = await service.summary();
    expect(s.views.open).toEqual({ count: 3, amount: '60.00' });
    expect(s.views.overdue).toEqual({ count: 1, amount: '10.00' });
    expect(s.views.week).toEqual({ count: 1, amount: '20.00' });
    expect(s.views.paid).toEqual({ count: 1, amount: '99.00' });
    expect(s.paidMonth).toEqual({ count: 1, amount: '99.00' });
    expect(s.nextDue).toBe(addDaysIso(today, 2));

    const f = await service.forecast();
    expect(f.buckets.find((b) => b.key === 'overdue')).toMatchObject({ count: 1, amount: '10.00' });
    expect(f.buckets.find((b) => b.key === 'w0')).toMatchObject({ count: 1, amount: '20.00' });
    expect(f.buckets.find((b) => b.key === 'w2')).toMatchObject({ count: 1, amount: '30.00' });
  });

  it('fornecedores com o aberto, categorias e duplicidade', async () => {
    await seed({ days: 4, amount: '40.00', supplier: 'ITEST Peças SA', category: 'Compras' });
    await seed({ days: 9, amount: '60.00', supplier: 'ITEST Peças SA' });
    await seed({ days: 1, amount: '15.00', supplier: 'ITEST Pago', status: 'PAID' });
    const sup = await service.suppliers();
    expect(sup[0]).toMatchObject({ name: 'ITEST Peças SA', openCount: 2, openAmount: '100.00', nextDue: addDaysIso(today, 4) });
    expect(sup.find((s) => s.name === 'ITEST Pago')).toMatchObject({ openCount: 0, openAmount: '0.00', nextDue: null });
    expect(await service.categories()).toContain('Compras');

    const dup = await service.duplicates({ supplier: 'itest peças sa', amount: 40, dueDate: addDaysIso(today, 6) });
    expect(dup).toHaveLength(1);
    expect(await service.duplicates({ supplier: 'itest peças sa', amount: 41, dueDate: addDaysIso(today, 6) })).toHaveLength(0);
    expect(await service.duplicates({ supplier: 'itest peças sa', amount: 40, dueDate: addDaysIso(today, 30) })).toHaveLength(0);
  });

  it('CSV com cabeçalho em português, valores em vírgula e fórmulas neutralizadas', async () => {
    await seed({ days: 3, amount: '1234.50', supplier: '=EVIL()' });
    const csv = await service.exportCsv({ view: 'open' });
    expect(csv.startsWith('﻿Fornecedor;CNPJ;')).toBe(true);
    expect(csv).toContain("'=EVIL()");
    expect(csv).toContain('1234,50');
    expect(csv).toContain('Em aberto');
  });

  it('linha digitável inválida na criação é recusada pelo schema', async () => {
    const { CreatePayableSchema } = await import('./payables.service.js');
    const r = CreatePayableSchema.safeParse({ supplierName: 'X', dueDate: '2026-12-01', amount: 10, barcode: '123' });
    expect(r.success).toBe(false);
  });
});
