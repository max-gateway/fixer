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

  listParts(search?: string) {
    const q = search?.trim();
    return this.prisma.part.findMany({
      where: q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] }
        : undefined,
      orderBy: { name: 'asc' },
      take: 100,
    });
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
