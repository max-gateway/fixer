import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { Database } from '../db/database.service.js';
import { StreamConsumer } from '../ingest/stream-consumer.service.js';
import { Metrics } from './metrics.service.js';

/** Endpoints operacionais (probes do Kubernetes e Prometheus). Não expõem dados de notificações. */
@Controller()
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly consumer: StreamConsumer,
    private readonly metrics: Metrics,
  ) {}

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  /** Pronto = consegue falar com Postgres e Redis. */
  @Get('health/ready')
  async ready() {
    try {
      await Promise.all([this.db.query('SELECT 1'), this.consumer.ping()]);
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
