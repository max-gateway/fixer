import { gzipSync } from 'node:zlib';
import { PrismaClient } from '@fixer/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantClient } from '../../test/db.js';
import { acquireDbLock } from '../../test/fiscal/db-lock.js';
import { BILLING_3X, makeAccessKey, makeProcNfe } from '../../test/fiscal/nfe-xml.js';
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
  const invoiceKeys = new Set<string>();

  /** Nota FULL com o XML original guardado, como a importação da SEFAZ a deixa. */
  const seedInvoice = async (o: { number: number; billing?: string; status?: 'FULL' | 'CANCELED' | 'IGNORED' }) => {
    const { xml, key } = makeProcNfe({ number: o.number, billing: o.billing, key: makeAccessKey('11222333000181', o.number) });
    invoiceKeys.add(key);
    return db.purchaseInvoice.create({
      data: { accessKey: key, issuerCnpj: '11222333000181', issuerName: 'AUTO PECAS DISTRIBUIDORA LTDA', totalAmount: '434.85', status: o.status ?? 'FULL', xmlGz: gzipSync(Buffer.from(xml)) },
    });
  };

  const cleanup = async () => {
    await db.payableEvent.deleteMany();
    await db.payable.deleteMany();
    await db.purchaseInvoice.deleteMany({ where: { accessKey: { in: [...invoiceKeys] } } });
    invoiceKeys.clear();
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

  describe('importação das notas já recebidas', () => {
    it('prévia não grava; a importação cria uma parcela por duplicata, em aberto, com a categoria de compras', async () => {
      await seedInvoice({ number: 9001, billing: BILLING_3X });
      const preview = await service.importFromInvoices({ dryRun: true }, actor);
      expect(preview).toMatchObject({ dryRun: true, invoices: 1, installments: 3, alreadyExisting: 0, open: { count: 3, amount: '434.85' }, settled: { count: 0, amount: '0.00' } });
      expect(await db.payable.count()).toBe(0);

      const done = await service.importFromInvoices({ dryRun: false }, actor);
      expect(done.open.count).toBe(3);
      const rows = await db.payable.findMany({ orderBy: { installment: 'asc' } });
      expect(rows.map((r) => [r.installment, r.installmentCount, r.amount.toFixed(2), r.status, r.category, r.documentNumber])).toEqual([
        [1, 3, '144.95', 'OPEN', 'Compras', '001'],
        [2, 3, '144.95', 'OPEN', 'Compras', '002'],
        [3, 3, '144.95', 'OPEN', 'Compras', '003'],
      ]);
      expect(rows[0]).toMatchObject({ supplierCnpj: '11222333000181', supplierName: 'AUTO PECAS DISTRIBUIDORA LTDA', source: 'XML_INSTALLMENT' });
    });

    it('rodar de novo não duplica; uma nota nova entra sozinha', async () => {
      await seedInvoice({ number: 9002, billing: BILLING_3X });
      await service.importFromInvoices({ dryRun: false }, actor);
      const again = await service.importFromInvoices({ dryRun: false }, actor);
      expect(again).toMatchObject({ installments: 3, alreadyExisting: 3, open: { count: 0 }, settled: { count: 0 } });
      expect(await db.payable.count()).toBe(3);

      await seedInvoice({ number: 9003, billing: BILLING_3X });
      expect((await service.importFromInvoices({ dryRun: false }, actor)).open.count).toBe(3);
      expect(await db.payable.count()).toBe(6);
    });

    it('parcelas anteriores à data de corte entram como pagas (histórico), com evento; as demais, em aberto', async () => {
      await seedInvoice({ number: 9004, billing: BILLING_3X }); // vencimentos 05/11/2026, 05/12/2026, 05/01/2027
      const r = await service.importFromInvoices({ settleBefore: '2026-12-10', dryRun: false }, actor);
      expect(r).toMatchObject({ open: { count: 1, amount: '144.95' }, settled: { count: 2, amount: '289.90' } });
      const rows = await db.payable.findMany({ orderBy: { installment: 'asc' }, include: { events: true } });
      expect(rows.map((x) => x.status)).toEqual(['PAID', 'PAID', 'OPEN']);
      expect(rows[0]).toMatchObject({ paidAmount: expect.anything() });
      expect(rows[0]!.paidAt!.toISOString().slice(0, 10)).toBe('2026-11-05');
      expect(rows[0]!.events.map((e) => [e.type, e.actorName])).toEqual([['PAID', 'Maria Teste']]);
      expect(rows[2]!.events).toHaveLength(0);
    });

    it('nota sem cobrança, cancelada ou ignorada não gera conta; o declarado em pag vira parcela única', async () => {
      await seedInvoice({ number: 9005 }); // sem cobr nem pag
      await seedInvoice({ number: 9006, billing: BILLING_3X, status: 'CANCELED' });
      await seedInvoice({ number: 9007, billing: BILLING_3X, status: 'IGNORED' });
      await seedInvoice({ number: 9008, billing: '<pag><detPag><indPag>0</indPag><tPag>01</tPag><vPag>434.85</vPag></detPag></pag>' });
      const r = await service.importFromInvoices({ dryRun: false }, actor);
      expect(r).toMatchObject({ invoices: 1, withoutBilling: 1, installments: 1, open: { count: 1, amount: '434.85' } });
      expect((await db.payable.findMany()).map((p) => p.source)).toEqual(['XML_TOTAL']);
    });

    it('XML corrompido é contado e não derruba a importação', async () => {
      const bad = await seedInvoice({ number: 9009, billing: BILLING_3X });
      await db.purchaseInvoice.update({ where: { id: bad.id }, data: { xmlGz: gzipSync(Buffer.from('<nao-e-nfe>')) } });
      await seedInvoice({ number: 9010, billing: BILLING_3X });
      const r = await service.importFromInvoices({ dryRun: false }, actor);
      expect(r).toMatchObject({ unreadable: 1, invoices: 1, open: { count: 3 } });
    });
  });
});
