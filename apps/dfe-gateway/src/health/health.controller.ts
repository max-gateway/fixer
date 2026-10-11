import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { Database } from '../db/database.service.js';
import { Metrics } from './metrics.service.js';

/** Endpoints operacionais. Não expõem dados de empresas; o nginx só publica `/v1` e `/healthz`. */
@Controller()
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly metrics: Metrics,
  ) {}

  @Get('healthz')
  live() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready() {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  metricsText() {
    return this.metrics.registry.metrics();
  }
}
