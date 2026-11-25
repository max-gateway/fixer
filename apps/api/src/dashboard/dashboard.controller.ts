import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/parse.js';
import { DashboardService } from './dashboard.service.js';

const QuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d'], { message: 'range deve ser 7d, 30d ou 90d' }).default('30d'),
});

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@Query() query: unknown) {
    return this.dashboard.overview(parse(QuerySchema, query).range);
  }
}
