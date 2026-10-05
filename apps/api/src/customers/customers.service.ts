import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCustomerInput, UpdateCustomerInput } from './schema.js';

const P2002 = 'P2002'; // violação de unique no Prisma

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list(search?: string) {
    const q = search?.trim();
    const digits = q?.replace(/\D/g, '');
    return this.prisma.customer.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              ...(digits ? [{ document: { contains: digits } }] : []),
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return customer;
  }

  async create(input: CreateCustomerInput) {
    try {
      return await this.prisma.customer.create({ data: input });
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  async update(id: string, input: UpdateCustomerInput) {
    try {
      return await this.prisma.customer.update({ where: { id }, data: input });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') {
        throw new NotFoundException('Cliente não encontrado');
      }
      throw this.mapUnique(err);
    }
  }

  private mapUnique(err: unknown): unknown {
    return (err as { code?: string }).code === P2002
      ? new ConflictException('Já existe um cliente com este documento')
      : err;
  }
}
