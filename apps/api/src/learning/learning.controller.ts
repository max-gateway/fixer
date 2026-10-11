import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../auth/permissions.js';
import { parse } from '../common/parse.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LearningService } from './learning.service.js';

const ExcludeSchema = z.object({ reason: z.string().trim().min(3, 'Informe o motivo').max(200) });

@Controller()
export class LearningController {
  constructor(
    private readonly learning: LearningService,
    private readonly prisma: PrismaService,
  ) {}

  /** Estimativa de horas do serviço para um veículo, com a origem (aprendida, referência ou sem histórico). */
  @Get('services/:id/estimate')
  async estimate(@Param('id') id: string, @Query('vehicleId') vehicleId?: string) {
    const service = await this.prisma.service.findUnique({ where: { id }, select: { definitionId: true } });
    if (!service?.definitionId) return { source: 'NONE' };
    const vehicle = vehicleId
      ? await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { variantId: true } })
      : null;
    return this.learning.estimate(service.definitionId, vehicle?.variantId ?? null);
  }

  /** Painel de outliers: observações excluídas ou candidatas, mais recentes primeiro. */
  @Get('admin/learning/observations')
  @RequirePermission('learning.manage')
  observations(@Query('excluded') excluded?: string) {
    return this.prisma.serviceObservation.findMany({
      where: excluded === undefined ? {} : { excluded: excluded === 'true' },
      orderBy: { observedAt: 'desc' },
      take: 200,
    });
  }

  @Post('admin/learning/observations/:id/exclude')
  @RequirePermission('learning.manage')
  exclude(@Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(ExcludeSchema, body);
    return this.prisma.$transaction((tx) => this.learning.excludeObservation(tx, id, reason));
  }

  @Post('admin/learning/rebuild')
  @RequirePermission('learning.manage')
  rebuild() {
    return this.prisma.$transaction((tx) => this.learning.rebuild(tx), { timeout: 60_000 });
  }
}
