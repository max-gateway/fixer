import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Database } from '../db/database.service.js';
import { Metrics } from './metrics.service.js';

/** Endpoints operacionais (probes do Kubernetes e Prometheus). Não expõem dados de mensagens. */
@Controller()
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly metrics: Metrics,
  ) {}

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
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
