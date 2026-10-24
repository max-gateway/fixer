import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

const money = z.number().nonnegative('Valor não pode ser negativo');

export const CreatePartSchema = z.object({
  sku: z.string().trim().min(1, 'SKU obrigatório'),
  name: z.string().trim().min(1, 'Nome obrigatório'),
  costPrice: money,
  sellPrice: money,
  supplierName: z.string().trim().nullable().optional(),
});

export const PurchaseSchema = z.object({
  quantity: z.number().positive('Quantidade deve ser positiva'),
  note: z.string().trim().nullable().optional(),
});

export const CreateServiceSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório'),
  description: z.string().trim().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  defaultPrice: money,
});

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** `catalogSku` devolve a peça da oficina que representa aquela peça do catálogo (no máximo uma), se já foi cadastrada. */
  listParts(search?: string, catalogSku?: string) {
    const q = search?.trim();
    const sku = catalogSku?.trim();
    return this.prisma.part.findMany({
      where: sku
        ? { catalogSku: sku }
        : q
          ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] }
          : undefined,
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  /**
   * Histórico da peça da oficina: entradas de estoque (com a nota e o fornecedor, quando vieram de NF-e), vendas em ordens de serviço e mudanças de
   * preço. Cada lista traz as 50 mais recentes; os totais são do período inteiro. OS cancelada não conta como venda.
   */
  async partHistory(partId: string) {
    const part = await this.prisma.part.findUnique({
      where: { id: partId },
      select: { id: true, sku: true, name: true, stockQty: true, costPrice: true, avgCost: true, sellPrice: true, catalogSku: true },
    });
    if (!part) throw new NotFoundException('Peça não encontrada');
    const soldWhere = { partId, serviceOrder: { status: { not: 'CANCELLED' as const } } };
    const [purchases, sales, prices, boughtAgg, soldAgg, soldCount] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { partId, type: 'PURCHASE' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          quantity: true,
          unitCost: true,
          note: true,
          purchaseInvoiceItem: { select: { invoice: { select: { id: true, number: true, issuerName: true, issuedAt: true } } } },
        },
      }),
      this.prisma.serviceOrderPartLine.findMany({
        where: soldWhere,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          quantity: true,
          unitPrice: true,
          unitCost: true,
          serviceOrder: {
            select: { id: true, number: true, status: true, customer: { select: { name: true } }, vehicle: { select: { plate: true, brand: true, model: true } } },
          },
        },
      }),
      this.prisma.partPriceHistory.findMany({
        where: { partId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, createdAt: true, costBefore: true, costAfter: true, sellBefore: true, sellAfter: true, marginAfter: true, source: true },
      }),
      this.prisma.stockMovement.aggregate({ where: { partId, type: 'PURCHASE' }, _sum: { quantity: true }, _count: true }),
      this.prisma.serviceOrderPartLine.aggregate({ where: soldWhere, _sum: { quantity: true } }),
      this.prisma.serviceOrderPartLine.count({ where: soldWhere }),
    ]);
    return {
      part,
      totals: { purchases: boughtAgg._count, boughtQty: boughtAgg._sum.quantity ?? 0, sales: soldCount, soldQty: soldAgg._sum.quantity ?? 0 },
      purchases,
      sales,
      prices,
    };
  }

  async createPart(input: z.infer<typeof CreatePartSchema>) {
    try {
      return await this.prisma.part.create({ data: input });
    } catch (err) {
      throw this.mapUnique(err, 'Já existe uma peça com este SKU');
    }
  }

  /** Entrada de estoque: soma ao saldo e registra o movimento PURCHASE no mesmo commit. */
  purchase(partId: string, input: z.infer<typeof PurchaseSchema>, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.part.findUnique({ where: { id: partId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Peça não encontrada');
      const part = await tx.part.update({
        where: { id: partId },
        data: { stockQty: { increment: input.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          partId,
          type: 'PURCHASE',
          quantity: input.quantity,
          balanceAfter: part.stockQty,
          note: input.note,
          createdById: user.id,
        },
      });
      return part;
    });
  }

  listServices() {
    return this.prisma.service.findMany({ orderBy: { name: 'asc' } });
  }

  async createService(input: z.infer<typeof CreateServiceSchema>) {
    try {
      return await this.prisma.service.create({ data: input });
    } catch (err) {
      throw this.mapUnique(err, 'Já existe um serviço com este nome');
    }
  }

  private mapUnique(err: unknown, message: string): unknown {
    return (err as { code?: string }).code === 'P2002' ? new ConflictException(message) : err;
  }
}
