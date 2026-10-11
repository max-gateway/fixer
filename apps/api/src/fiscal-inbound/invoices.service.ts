import { gunzipSync } from 'node:zlib';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@fixer/db';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { unitCost } from './matching/cost.js';
import { matchOpenInvoicesOfSupplier, recomputeExportStatus } from './matching/reconcile.js';

/** Abas da lista de notas (docs/specs/nfe-import.md §11). Cada uma é um filtro sobre os dois eixos de estado. */
export const VIEWS = ['pending', 'ready', 'posted', 'summary', 'canceled', 'ignored', 'all'] as const;
export type View = (typeof VIEWS)[number];

const VIEW_WHERE: Record<View, Prisma.PurchaseInvoiceWhereInput> = {
  // Precisa de ação do usuário: vincular itens ou revisar.
  pending: { status: 'FULL', exportStatus: 'PENDING_MATCH' },
  ready: { status: 'FULL', exportStatus: 'READY' },
  posted: { exportStatus: 'POSTED' },
  // Ainda sem XML completo (falta a ciência, ou ela está a caminho).
  summary: { status: { in: ['SUMMARY', 'MANIFESTED'] } },
  canceled: { status: 'CANCELED' },
  ignored: { status: 'IGNORED' },
  all: {},
};

export const ListQuerySchema = z.object({
  view: z.enum(VIEWS).default('pending'),
  q: z.string().trim().max(100).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export const ItemActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('link'),
    partId: z.string().min(1, 'Escolha a peça'),
    /** Unidades de estoque por unidade da nota (caixa de 4 = 4). */
    unitFactor: z.number().positive('O fator deve ser maior que zero').max(1_000_000).default(1),
    /** Aprende o vínculo para as próximas notas do fornecedor. */
    saveMapping: z.boolean().default(true),
  }),
  z.object({ action: z.literal('ignore') }),
  z.object({ action: z.literal('reset') }),
]);

export const CreatePartSchema = z.object({
  sku: z.string().trim().min(1).max(60).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  sellPrice: z.number({ required_error: 'Informe o preço de venda', invalid_type_error: 'Preço inválido' }).nonnegative('Preço não pode ser negativo'),
  unitFactor: z.number().positive().max(1_000_000).default(1),
  saveMapping: z.boolean().default(true),
});

/** Só notas completas e ainda não lançadas aceitam conciliação. */
const EDITABLE = ['PENDING_MATCH', 'READY'];

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: z.infer<typeof ListQuerySchema>) {
    const where: Prisma.PurchaseInvoiceWhereInput = { ...VIEW_WHERE[query.view] };
    if (query.q) {
      const q = query.q;
      const digits = q.replace(/\D/g, '');
      where.OR = [
        { issuerName: { contains: q, mode: 'insensitive' } },
        { accessKey: { contains: q.toUpperCase() } },
        { issuerCnpj: { contains: q.toUpperCase().replace(/[.\-/]/g, '') } },
        ...(digits.length > 0 && digits.length <= 9 ? [{ number: Number(digits) }] : []),
      ];
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseInvoice.findMany({
        where,
        orderBy: [{ issuedAt: { sort: 'desc', nulls: 'last' } }, { receivedAt: 'desc' }],
        take: query.take,
        skip: query.skip,
        select: {
          id: true,
          accessKey: true,
          number: true,
          series: true,
          issuedAt: true,
          issuerName: true,
          issuerCnpj: true,
          totalAmount: true,
          status: true,
          exportStatus: true,
          needsReview: true,
          manifestError: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);

    // Itens sem vínculo por nota, numa consulta só (evita N+1).
    const ids = rows.map((r) => r.id);
    const pending = ids.length
      ? await this.prisma.purchaseInvoiceItem.groupBy({ by: ['invoiceId'], where: { invoiceId: { in: ids }, resolution: 'UNRESOLVED' }, _count: { _all: true } })
      : [];
    const unresolved = new Map(pending.map((p) => [p.invoiceId, p._count._all]));

    return {
      total,
      items: rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items, unresolvedCount: unresolved.get(r.id) ?? 0 })),
    };
  }

  /** Contagem por aba, para os selos da lista. */
  async summary(): Promise<Record<View, number>> {
    const counts = await this.prisma.$transaction(VIEWS.map((v) => this.prisma.purchaseInvoice.count({ where: VIEW_WHERE[v] })));
    return Object.fromEntries(VIEWS.map((v, i) => [v, counts[i]!])) as Record<View, number>;
  }

  async get(id: string) {
    // `nsu` é BigInt (o JSON puro não o serializa) e a tela não precisa dele; o XML nunca sai por aqui.
    const { xmlGz, xmlSha256: _sha, nsu: _nsu, ...invoice } = await this.require(id, { items: { orderBy: { itemNumber: 'asc' }, include: { part: { select: { id: true, sku: true, name: true, stockQty: true } } } } });
    return { ...invoice, hasXml: xmlGz !== null };
  }

  /** XML original (guarda fiscal), exatamente como a SEFAZ entregou. */
  async xml(id: string): Promise<{ filename: string; xml: string }> {
    const inv = await this.prisma.purchaseInvoice.findUnique({ where: { id }, select: { accessKey: true, xmlGz: true } });
    if (!inv) throw new NotFoundException('Nota não encontrada');
    if (!inv.xmlGz) throw new NotFoundException('A nota ainda não tem o XML completo (falta a ciência da operação)');
    return { filename: `NFe${inv.accessKey}.xml`, xml: gunzipSync(Buffer.from(inv.xmlGz)).toString('utf8') };
  }

  /** Liga, ignora ou desfaz o vínculo de um item. Aprender o vínculo resolve as outras notas em aberto do fornecedor. */
  async setItem(invoiceId: string, itemNumber: number, input: z.infer<typeof ItemActionSchema>) {
    await this.prisma.$transaction(async (tx) => {
      const { invoice, item } = await this.editableItem(tx, invoiceId, itemNumber);

      if (input.action === 'link') {
        const part = await tx.part.findUnique({ where: { id: input.partId }, select: { id: true } });
        if (!part) throw new BadRequestException('Peça não encontrada');
        await tx.purchaseInvoiceItem.update({
          where: { id: item.id },
          data: { resolution: 'MANUAL', partId: part.id, unitFactor: String(input.unitFactor) },
        });
        if (input.saveMapping) await this.learn(tx, invoice, item.supplierCode, part.id, input.unitFactor);
      } else if (input.action === 'ignore') {
        await tx.purchaseInvoiceItem.update({ where: { id: item.id }, data: { resolution: 'IGNORED', partId: null, unitFactor: '1' } });
      } else {
        await tx.purchaseInvoiceItem.update({ where: { id: item.id }, data: { resolution: 'UNRESOLVED', partId: null, unitFactor: '1' } });
      }
      await recomputeExportStatus(tx, invoiceId);
    });
    return this.get(invoiceId);
  }

  /**
   * Cadastra a peça a partir do item da nota (NCM, CEST, origem, GTIN, unidade e custo vêm do XML) e já a
   * vincula. É o caminho de cadastro por XML do service-catalog §4.3.1.
   */
  async createPartFromItem(invoiceId: string, itemNumber: number, input: z.infer<typeof CreatePartSchema>) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const { invoice, item } = await this.editableItem(tx, invoiceId, itemNumber);
        const cost = unitCost(item, input.unitFactor);
        if (!cost) throw new BadRequestException('Item sem quantidade: não há custo para calcular');

        const part = await tx.part.create({
          data: {
            sku: input.sku ?? item.supplierCode.toUpperCase().slice(0, 60),
            name: input.name ?? item.description.slice(0, 200),
            costPrice: cost,
            sellPrice: input.sellPrice,
            supplierName: invoice.issuerName,
            ean: item.ean,
            ncm: item.ncm || null,
            cest: item.cest,
            originCode: item.origin,
            // Se a nota vem em caixa e o estoque conta unidades, a unidade da peça deixa de ser a da nota.
            unit: input.unitFactor === 1 ? item.unit : 'UN',
          },
        });
        await tx.purchaseInvoiceItem.update({
          where: { id: item.id },
          data: { resolution: 'MANUAL', partId: part.id, unitFactor: String(input.unitFactor) },
        });
        if (input.saveMapping) await this.learn(tx, invoice, item.supplierCode, part.id, input.unitFactor);
        await recomputeExportStatus(tx, invoiceId);
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException('Já existe uma peça com este SKU');
      throw err;
    }
    return this.get(invoiceId);
  }

  /** O usuário revisou uma nota com finalidade diferente de "normal"; libera o fluxo normal de lançamento. */
  async clearReview(invoiceId: string) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await tx.purchaseInvoice.findUnique({ where: { id: invoiceId }, select: { status: true, exportStatus: true, needsReview: true } });
      if (!inv) throw new NotFoundException('Nota não encontrada');
      if (inv.status !== 'FULL' || !EDITABLE.includes(inv.exportStatus)) throw new ConflictException('Esta nota não está em conciliação');
      if (!inv.needsReview) return;
      await tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { needsReview: false } });
      await recomputeExportStatus(tx, invoiceId);
    });
    return this.get(invoiceId);
  }

  private async learn(tx: Prisma.TransactionClient, invoice: { id: string; issuerCnpj: string }, supplierCode: string, partId: string, unitFactor: number) {
    await tx.supplierItemMap.upsert({
      where: { supplierCnpj_supplierCode: { supplierCnpj: invoice.issuerCnpj, supplierCode } },
      create: { supplierCnpj: invoice.issuerCnpj, supplierCode, partId, unitFactor: String(unitFactor) },
      // Decisão explícita do usuário vence o que estava aprendido.
      update: { partId, unitFactor: String(unitFactor), lastUsedAt: new Date() },
    });
    await matchOpenInvoicesOfSupplier(tx, invoice.issuerCnpj, invoice.id);
  }

  private async editableItem(tx: Prisma.TransactionClient, invoiceId: string, itemNumber: number) {
    const invoice = await tx.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true, exportStatus: true, issuerCnpj: true, issuerName: true },
    });
    if (!invoice) throw new NotFoundException('Nota não encontrada');
    if (invoice.status !== 'FULL' || !EDITABLE.includes(invoice.exportStatus)) {
      throw new ConflictException('Esta nota não aceita mais alterações de vínculo (já lançada, cancelada ou sem XML completo)');
    }
    const item = await tx.purchaseInvoiceItem.findUnique({ where: { invoiceId_itemNumber: { invoiceId, itemNumber } } });
    if (!item) throw new NotFoundException('Item não encontrado');
    return { invoice, item };
  }

  private async require<T extends Prisma.PurchaseInvoiceInclude>(id: string, include: T) {
    const inv = await this.prisma.purchaseInvoice.findUnique({ where: { id }, include });
    if (!inv) throw new NotFoundException('Nota não encontrada');
    return inv;
  }
}
