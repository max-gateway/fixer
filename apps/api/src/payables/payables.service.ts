import { gunzipSync } from 'node:zlib';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@fixer/db';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseBoleto } from './boleto.js';
import { csvDate, csvMoney, toCsv } from './csv.js';
import { addDaysIso, addMonths, civil, isoDay, monthStartIso, todayIso } from './dates.js';
import { parseProcNfe } from '../fiscal-inbound/parser/nfe.parser.js';
import { buildForecast, toCents } from './forecast.js';
import { draftPayables } from './installments.js';

/** Abas da lista. `overdue` e `week` são derivadas da data; só `OPEN` entra nelas. */
export const VIEWS = ['open', 'overdue', 'week', 'paid', 'canceled', 'all'] as const;
export type View = (typeof VIEWS)[number];

export const PAYMENT_METHODS = ['PIX', 'BOLETO', 'TED', 'DINHEIRO', 'CARTAO', 'DEBITO_AUTOMATICO', 'OUTRO'] as const;

/** Sugestões de categoria; o campo é texto livre e as já usadas pela empresa entram na lista. */
export const SUGGESTED_CATEGORIES = [
  'Compras',
  'Aluguel',
  'Energia, água e internet',
  'Folha e encargos',
  'Impostos e taxas',
  'Serviços de terceiros',
  'Marketing',
  'Manutenção e equipamentos',
  'Outros',
] as const;

/** Categoria das contas geradas dos XMLs (compra de mercadoria). */
export const NFE_CATEGORY = 'Compras';

const money = z.number({ invalid_type_error: 'Valor inválido' }).positive('O valor deve ser maior que zero').max(999_999_999.99);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Data inválida');

const barcode = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null;
    const r = parseBoleto(v);
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.reason === 'LENGTH' ? 'A linha digitável deve ter 47 ou 48 dígitos' : 'Linha digitável inválida: confira os números' });
      return z.NEVER;
    }
    return r.digits;
  });

const FilterShape = {
  q: z.string().trim().max(100).optional(),
  supplier: z.string().trim().max(200).optional(),
  category: z.string().trim().max(60).optional(),
  source: z.enum(['nfe', 'manual']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
};

export const ListQuerySchema = z.object({
  view: z.enum(VIEWS).default('open'),
  ...FilterShape,
  sort: z.enum(['due', 'amount', 'supplier', 'paid']).default('due'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  take: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const ExportQuerySchema = z.object({ view: z.enum(VIEWS).default('open'), ...FilterShape });

export const CreatePayableSchema = z.object({
  supplierName: z.string().trim().min(1, 'Informe o fornecedor').max(200),
  supplierCnpj: z.string().trim().max(20).optional(),
  description: z.string().trim().max(300).optional(),
  category: z.string().trim().max(60).optional(),
  documentNumber: z.string().trim().max(60).optional(),
  barcode: barcode.optional(),
  dueDate: isoDate,
  amount: money,
  /** Total dividido em parcelas mensais a partir do primeiro vencimento. */
  installments: z.number().int().min(1).max(60).default(1),
  notes: z.string().trim().max(1000).optional(),
});

const adjust = z.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Não pode ser negativo').max(999_999_999.99);

export const PaySchema = z.object({
  paidAt: isoDate.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  /** Juros e multa pagos além do valor da conta. */
  interest: adjust.optional(),
  /** Desconto obtido. */
  discount: adjust.optional(),
});

export const UpdatePayableSchema = z
  .object({
    dueDate: isoDate,
    amount: money,
    notes: z.string().trim().max(1000).nullable(),
    category: z.string().trim().max(60).nullable(),
    description: z.string().trim().max(300).nullable(),
    barcode: barcode.nullable(),
    supplierName: z.string().trim().min(1).max(200),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nada para alterar');

export const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Selecione ao menos uma conta').max(200, 'No máximo 200 contas por vez'),
  action: z.enum(['pay', 'unpay', 'cancel']),
  paidAt: isoDate.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
});

export const ImportSchema = z.object({
  /** Parcelas com vencimento ANTES desta data entram como já pagas (histórico); as demais, em aberto. Vazio: tudo em aberto. */
  settleBefore: isoDate.optional(),
  /** Só conta o que seria importado, sem gravar. */
  dryRun: z.boolean().default(false),
});

export const DuplicatesQuerySchema = z.object({
  supplier: z.string().trim().min(1).max(200),
  amount: z.coerce.number().positive(),
  dueDate: isoDate,
});

/** Divide `total` em `n` parcelas em centavos; a diferença de arredondamento vai para a primeira. */
export function splitAmount(total: number, n: number): string[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const first = base + (cents - base * n);
  return Array.from({ length: n }, (_, i) => ((i === 0 ? first : base) / 100).toFixed(2));
}

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));
const normCnpj = (v: string) => v.replace(/[.\-/\s]/g, '').toUpperCase();

const INVOICE_REF = { select: { id: true, number: true, series: true, accessKey: true } } as const;

type Actor = Pick<AuthUser, 'id' | 'name'>;

@Injectable()
export class PayablesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- filtros ----------

  private viewWhere(view: View, today = todayIso()): Prisma.PayableWhereInput {
    switch (view) {
      case 'open':
        return { status: 'OPEN' };
      case 'overdue':
        return { status: 'OPEN', dueDate: { lt: civil(today) } };
      case 'week':
        return { status: 'OPEN', dueDate: { gte: civil(today), lte: civil(addDaysIso(today, 7)) } };
      case 'paid':
        return { status: 'PAID' };
      case 'canceled':
        return { status: 'CANCELED' };
      default:
        return {};
    }
  }

  private where(f: z.infer<typeof ExportQuerySchema>): Prisma.PayableWhereInput {
    const and: Prisma.PayableWhereInput[] = [this.viewWhere(f.view)];
    if (f.supplier) and.push({ OR: [{ supplierName: { equals: f.supplier, mode: 'insensitive' } }, { supplierCnpj: normCnpj(f.supplier) }] });
    if (f.category) and.push({ category: f.category });
    if (f.source) and.push({ source: f.source === 'manual' ? 'MANUAL' : { in: ['XML_INSTALLMENT', 'XML_TOTAL'] } });
    if (f.from || f.to) and.push({ dueDate: { ...(f.from ? { gte: civil(f.from) } : {}), ...(f.to ? { lte: civil(f.to) } : {}) } });
    if (f.q) {
      and.push({
        OR: [
          { supplierName: { contains: f.q, mode: 'insensitive' } },
          { supplierCnpj: { contains: normCnpj(f.q) } },
          { documentNumber: { contains: f.q, mode: 'insensitive' } },
          { description: { contains: f.q, mode: 'insensitive' } },
          { category: { contains: f.q, mode: 'insensitive' } },
        ],
      });
    }
    return { AND: and };
  }

  private orderBy(q: Pick<ListQuery, 'sort' | 'dir'>): Prisma.PayableOrderByWithRelationInput[] {
    const dir = q.dir;
    switch (q.sort) {
      case 'amount':
        return [{ amount: dir }, { dueDate: 'asc' }];
      case 'supplier':
        return [{ supplierName: dir }, { dueDate: 'asc' }];
      case 'paid':
        return [{ paidAt: { sort: dir, nulls: 'last' } }, { dueDate: 'asc' }];
      default:
        return [{ dueDate: dir }, { createdAt: 'asc' }];
    }
  }

  // ---------- consultas ----------

  async list(query: ListQuery) {
    const where = this.where(query);
    const [items, total, agg] = await Promise.all([
      this.prisma.payable.findMany({ where, orderBy: this.orderBy(query), take: query.take, skip: query.skip, include: { invoice: INVOICE_REF } }),
      this.prisma.payable.count({ where }),
      this.prisma.payable.aggregate({ where, _sum: { amount: true } }),
    ]);
    return { total, totalAmount: (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), items };
  }

  /** Contagem e valor por aba, e o que foi pago no mês. */
  async summary() {
    const today = todayIso();
    const views = Object.fromEntries(
      await Promise.all(
        VIEWS.map(async (v) => {
          const agg = await this.prisma.payable.aggregate({ where: this.viewWhere(v, today), _count: { _all: true }, _sum: { amount: true } });
          return [v, { count: agg._count._all, amount: (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) }] as const;
        }),
      ),
    ) as Record<View, { count: number; amount: string }>;

    const paidMonth = await this.prisma.payable.aggregate({
      where: { status: 'PAID', paidAt: { gte: civil(monthStartIso(today)) } },
      _count: { _all: true },
      _sum: { paidAmount: true },
    });
    const next = await this.prisma.payable.findFirst({ where: { status: 'OPEN', dueDate: { gte: civil(today) } }, orderBy: { dueDate: 'asc' }, select: { dueDate: true } });
    return {
      views,
      paidMonth: { count: paidMonth._count._all, amount: (paidMonth._sum.paidAmount ?? new Prisma.Decimal(0)).toFixed(2) },
      nextDue: next ? isoDay(next.dueDate) : null,
      today,
    };
  }

  /** Saída de caixa prevista das contas em aberto: vencidas, janelas de 7 dias e "mais tarde". */
  async forecast(weeks = 8) {
    const today = todayIso();
    const rows = await this.prisma.payable.findMany({ where: { status: 'OPEN' }, select: { dueDate: true, amount: true } });
    return { today, buckets: buildForecast(rows.map((r) => ({ dueDate: isoDay(r.dueDate), amount: r.amount.toFixed(2) })), today, weeks) };
  }

  /** Fornecedores com o que há em aberto (alimenta o filtro e o autocompletar). */
  async suppliers() {
    const [all, open] = await Promise.all([
      this.prisma.payable.groupBy({ by: ['supplierName', 'supplierCnpj'], where: { status: { not: 'CANCELED' } }, _count: { _all: true } }),
      this.prisma.payable.groupBy({ by: ['supplierName', 'supplierCnpj'], where: { status: 'OPEN' }, _count: { _all: true }, _sum: { amount: true }, _min: { dueDate: true } }),
    ]);
    const key = (n: string, c: string | null) => `${c ?? ''}|${n.toLowerCase()}`;
    const openBy = new Map(open.map((o) => [key(o.supplierName, o.supplierCnpj), o]));
    return all
      .map((a) => {
        const o = openBy.get(key(a.supplierName, a.supplierCnpj));
        return {
          name: a.supplierName,
          cnpj: a.supplierCnpj,
          openCount: o?._count._all ?? 0,
          openAmount: (o?._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
          nextDue: o?._min.dueDate ? isoDay(o._min.dueDate) : null,
        };
      })
      .sort((a, b) => Number(b.openAmount) - Number(a.openAmount) || a.name.localeCompare(b.name))
      .slice(0, 200);
  }

  async categories(): Promise<string[]> {
    const used = await this.prisma.payable.findMany({ where: { category: { not: null } }, distinct: ['category'], select: { category: true }, take: 100 });
    return [...new Set([...SUGGESTED_CATEGORIES, ...used.map((u) => u.category!)])];
  }

  /** Contas parecidas (mesmo fornecedor e valor, vencimento até 5 dias de distância): alerta de lançamento em duplicidade. */
  async duplicates(q: z.infer<typeof DuplicatesQuerySchema>) {
    return this.prisma.payable.findMany({
      where: {
        status: { not: 'CANCELED' },
        amount: dec(q.amount),
        dueDate: { gte: civil(addDaysIso(q.dueDate, -5)), lte: civil(addDaysIso(q.dueDate, 5)) },
        OR: [{ supplierName: { equals: q.supplier, mode: 'insensitive' } }, { supplierCnpj: normCnpj(q.supplier) }],
      },
      select: { id: true, supplierName: true, documentNumber: true, dueDate: true, amount: true, status: true, source: true },
      orderBy: { dueDate: 'asc' },
      take: 3,
    });
  }

  /** O que o usuário pode fazer aqui, para a tela esconder botões que a API recusaria. */
  async access(userId: string) {
    const has = async (key: string) => (await this.prisma.rolePermission.count({ where: { permission: { key }, role: { users: { some: { userId } } } } })) > 0;
    const [manage, pay] = await Promise.all([has('payables.manage'), has('payables.pay')]);
    return { manage, pay };
  }

  parseBarcode(code: string) {
    return parseBoleto(code);
  }

  async get(id: string) {
    const p = await this.prisma.payable.findUnique({
      where: { id },
      include: {
        invoice: { select: { id: true, number: true, series: true, accessKey: true, issuedAt: true, totalAmount: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!p) throw new NotFoundException('Conta não encontrada');
    // As outras parcelas da mesma nota dão contexto ("2 de 3") e deixam conferir a soma contra o total da nota.
    const siblings = p.invoiceId
      ? await this.prisma.payable.findMany({
          where: { invoiceId: p.invoiceId },
          orderBy: { installment: 'asc' },
          select: { id: true, installment: true, dueDate: true, amount: true, status: true },
        })
      : [];
    return { ...p, siblings };
  }

  async exportCsv(f: z.infer<typeof ExportQuerySchema>): Promise<string> {
    const rows = await this.prisma.payable.findMany({ where: this.where(f), orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 5000, include: { invoice: INVOICE_REF } });
    const STATUS = { OPEN: 'Em aberto', PAID: 'Paga', CANCELED: 'Cancelada' } as const;
    return toCsv(
      ['Fornecedor', 'CNPJ', 'Documento', 'Parcela', 'Descrição', 'Categoria', 'Origem', 'Vencimento', 'Valor', 'Situação', 'Pago em', 'Valor pago', 'Forma de pagamento', 'Nota fiscal'],
      rows.map((p) => [
        p.supplierName,
        p.supplierCnpj,
        p.documentNumber,
        `${p.installment}/${p.installmentCount}`,
        p.description,
        p.category,
        p.source === 'MANUAL' ? 'Avulsa' : 'NF-e',
        csvDate(isoDay(p.dueDate)),
        csvMoney(p.amount.toFixed(2)),
        STATUS[p.status],
        p.paidAt ? csvDate(isoDay(p.paidAt)) : '',
        p.paidAmount ? csvMoney(p.paidAmount.toFixed(2)) : '',
        p.paymentMethod,
        p.invoice?.number != null ? String(p.invoice.number) : '',
      ]),
    );
  }

  // ---------- escrita ----------

  async create(input: z.infer<typeof CreatePayableSchema>, actor: Actor) {
    const rows = splitAmount(input.amount, input.installments).map((amount, i) => ({
      source: 'MANUAL' as const,
      supplierName: input.supplierName,
      supplierCnpj: input.supplierCnpj ? normCnpj(input.supplierCnpj) : null,
      description: input.description || null,
      category: input.category || null,
      barcode: input.barcode ?? null,
      documentNumber: input.documentNumber || null,
      notes: input.notes || null,
      installment: i + 1,
      installmentCount: input.installments,
      dueDate: addMonths(input.dueDate, i),
      amount,
    }));
    return this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const data of rows) {
        const p = await tx.payable.create({ data });
        await this.record(tx, p.id, 'CREATED', actor, { amount: data.amount, dueDate: isoDay(data.dueDate) });
        created.push(p);
      }
      return created;
    });
  }

  async update(id: string, input: z.infer<typeof UpdatePayableSchema>, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payable.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Conta não encontrada');
      if (p.status !== 'OPEN') throw new ConflictException('Só contas em aberto podem ser editadas');
      if (input.supplierName !== undefined && p.source !== 'MANUAL') throw new BadRequestException('O fornecedor de uma conta de NF-e vem do XML e não pode ser alterado');

      const data: Prisma.PayableUpdateInput = {};
      const changes: Record<string, { from: string | null; to: string | null }> = {};
      const set = <K extends keyof Prisma.PayableUpdateInput>(field: K, value: Prisma.PayableUpdateInput[K], from: string | null, to: string | null) => {
        data[field] = value;
        changes[field as string] = { from, to };
      };
      if (input.dueDate && input.dueDate !== isoDay(p.dueDate)) set('dueDate', civil(input.dueDate), isoDay(p.dueDate), input.dueDate);
      if (input.amount !== undefined && !dec(input.amount).equals(p.amount)) set('amount', dec(input.amount), p.amount.toFixed(2), input.amount.toFixed(2));
      if (input.notes !== undefined && (input.notes || null) !== p.notes) set('notes', input.notes || null, p.notes, input.notes || null);
      if (input.category !== undefined && (input.category || null) !== p.category) set('category', input.category || null, p.category, input.category || null);
      if (input.description !== undefined && (input.description || null) !== p.description) set('description', input.description || null, p.description, input.description || null);
      if (input.barcode !== undefined && input.barcode !== p.barcode) set('barcode', input.barcode, p.barcode, input.barcode);
      if (input.supplierName !== undefined && input.supplierName !== p.supplierName) set('supplierName', input.supplierName, p.supplierName, input.supplierName);
      if (Object.keys(changes).length === 0) return;

      await tx.payable.update({ where: { id }, data });
      await this.record(tx, id, 'EDITED', actor, changes);
    });
    return this.get(id);
  }

  async pay(id: string, input: z.infer<typeof PaySchema>, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payable.findUnique({ where: { id }, select: { id: true, status: true, amount: true } });
      if (!p) throw new NotFoundException('Conta não encontrada');
      if (p.status !== 'OPEN') throw new ConflictException('Esta conta já foi paga ou cancelada');
      const interest = dec(input.interest ?? 0);
      const discount = dec(input.discount ?? 0);
      const total = p.amount.plus(interest).minus(discount);
      if (total.lte(0)) throw new BadRequestException('O desconto não pode zerar ou superar o valor da conta');
      const paidAt = input.paidAt ? civil(input.paidAt) : civil(todayIso());
      // updateMany com guarda de status: dois cliques simultâneos não pagam duas vezes.
      const { count } = await tx.payable.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'PAID', paidAt, paidAmount: total, interest: interest.isZero() ? null : interest, discount: discount.isZero() ? null : discount, paymentMethod: input.method ?? null, paidById: actor.id },
      });
      if (count === 0) throw new ConflictException('Esta conta já foi paga ou cancelada');
      await this.record(tx, id, 'PAID', actor, { paidAt: isoDay(paidAt), paidAmount: total.toFixed(2), method: input.method ?? null });
    });
    return this.get(id);
  }

  /** Desfaz um pagamento lançado por engano. */
  async unpay(id: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payable.updateMany({
        where: { id, status: 'PAID' },
        data: { status: 'OPEN', paidAt: null, paidAmount: null, interest: null, discount: null, paymentMethod: null, paidById: null },
      });
      if (count === 0) throw new ConflictException('Esta conta não está paga');
      await this.record(tx, id, 'UNPAID', actor);
    });
    return this.get(id);
  }

  async cancel(id: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payable.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CANCELED' } });
      if (count === 0) throw new ConflictException('Só contas em aberto podem ser canceladas');
      await this.record(tx, id, 'CANCELED', actor);
    });
    return this.get(id);
  }

  /**
   * Ação em lote. Cada conta é tratada pela mesma guarda de status das ações individuais; as que não estavam no estado
   * esperado são devolvidas em `skipped` em vez de falhar o lote inteiro.
   */
  async bulk(input: z.infer<typeof BulkSchema>, actor: Actor) {
    const ids = [...new Set(input.ids)];
    const done: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.payable.findMany({ where: { id: { in: ids } }, select: { id: true, amount: true } });
      const paidAt = input.paidAt ? civil(input.paidAt) : civil(todayIso());
      for (const r of rows) {
        let count = 0;
        if (input.action === 'pay') {
          ({ count } = await tx.payable.updateMany({
            where: { id: r.id, status: 'OPEN' },
            data: { status: 'PAID', paidAt, paidAmount: r.amount, paymentMethod: input.method ?? null, paidById: actor.id },
          }));
          if (count) await this.record(tx, r.id, 'PAID', actor, { paidAt: isoDay(paidAt), paidAmount: r.amount.toFixed(2), method: input.method ?? null, bulk: true });
        } else if (input.action === 'unpay') {
          ({ count } = await tx.payable.updateMany({
            where: { id: r.id, status: 'PAID' },
            data: { status: 'OPEN', paidAt: null, paidAmount: null, interest: null, discount: null, paymentMethod: null, paidById: null },
          }));
          if (count) await this.record(tx, r.id, 'UNPAID', actor, { bulk: true });
        } else {
          ({ count } = await tx.payable.updateMany({ where: { id: r.id, status: 'OPEN' }, data: { status: 'CANCELED' } }));
          if (count) await this.record(tx, r.id, 'CANCELED', actor, { bulk: true });
        }
        if (count) done.push(r.id);
      }
    });
    return { done, skipped: ids.filter((i) => !done.includes(i)) };
  }

  /**
   * Gera as contas a pagar das notas de compra JÁ recebidas, lendo o XML original guardado de cada uma. Idempotente: parcela
   * que já existe (mesma nota e número) é pulada, então pode rodar de novo depois de importar mais notas. `dryRun` só conta.
   */
  async importFromInvoices(input: z.infer<typeof ImportSchema>, actor: Actor) {
    const settleBefore = input.settleBefore ?? null;
    const sum = { open: 0n, settled: 0n };
    const stats = { dryRun: input.dryRun, invoices: 0, withoutBilling: 0, unreadable: 0, installments: 0, alreadyExisting: 0, open: { count: 0, amount: '0.00' }, settled: { count: 0, amount: '0.00' } };
    const fmt = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.purchaseInvoice.findMany({
        where: { status: 'FULL', xmlGz: { not: null } },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, xmlGz: true, issuerCnpj: true, issuerName: true },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;

      const existing = await this.prisma.payable.findMany({ where: { invoiceId: { in: batch.map((b) => b.id) } }, select: { invoiceId: true, installment: true } });
      const have = new Set(existing.map((e) => `${e.invoiceId}:${e.installment}`));

      const open: Prisma.PayableCreateManyInput[] = [];
      const settled: Prisma.PayableCreateInput[] = [];
      for (const inv of batch) {
        let drafts;
        try {
          drafts = draftPayables(parseProcNfe(gunzipSync(Buffer.from(inv.xmlGz!)).toString('utf8')));
        } catch {
          stats.unreadable++;
          continue;
        }
        if (drafts.length === 0) {
          stats.withoutBilling++;
          continue;
        }
        stats.invoices++;
        for (const d of drafts) {
          stats.installments++;
          if (have.has(`${inv.id}:${d.installment}`)) {
            stats.alreadyExisting++;
            continue;
          }
          const base = { ...d, supplierCnpj: inv.issuerCnpj, supplierName: inv.issuerName, category: NFE_CATEGORY };
          const cents = toCents(d.amount);
          if (settleBefore && isoDay(d.dueDate) < settleBefore) {
            stats.settled.count++;
            sum.settled += cents;
            settled.push({
              ...base,
              invoice: { connect: { id: inv.id } },
              status: 'PAID',
              paidAt: d.dueDate,
              paidAmount: d.amount,
              events: { create: { type: 'PAID', actorId: actor.id, actorName: actor.name, data: { imported: true, paidAt: isoDay(d.dueDate), paidAmount: d.amount } } },
            });
          } else {
            stats.open.count++;
            sum.open += cents;
            open.push({ ...base, invoiceId: inv.id });
          }
        }
      }
      if (!input.dryRun && (open.length || settled.length)) {
        await this.prisma.$transaction(async (tx) => {
          if (open.length) await tx.payable.createMany({ data: open, skipDuplicates: true });
          for (const data of settled) await tx.payable.create({ data });
        });
      }
    }
    stats.open.amount = fmt(sum.open);
    stats.settled.amount = fmt(sum.settled);
    return stats;
  }

  private record(tx: Prisma.TransactionClient, payableId: string, type: 'CREATED' | 'EDITED' | 'PAID' | 'UNPAID' | 'CANCELED', actor: Actor, data?: Prisma.InputJsonValue) {
    return tx.payableEvent.create({ data: { payableId, type, actorId: actor.id, actorName: actor.name, ...(data ? { data } : {}) } });
  }
}
