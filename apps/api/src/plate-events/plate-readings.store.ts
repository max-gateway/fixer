import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PlateEventsConfig } from './plate-events.config.js';
import type { PlateEvent } from './schema.js';

export interface StoredReading {
  status: PlateEvent['result']['status'];
  plate: string | null;
  plateFormat: PlateEvent['result']['plate_format'];
  confidence: number;
  candidates: PlateEvent['result']['raw_candidates'];
  processedAt: string;
}

/**
 * Entrega do resultado do OCR ao frontend. O plate-reader é assíncrono (202 +
 * evento no stream), então o handler grava o resultado aqui por request_id e a
 * UI faz polling. Redis com TTL curto: é um repasse transitório, não histórico —
 * e o SET idempotente absorve reentregas at-least-once do consumer group.
 */
@Injectable()
export class PlateReadingsStore implements OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(private readonly config: PlateEventsConfig) {
    this.redis = new Redis(config.redisUrl, {
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
  }

  async save(event: PlateEvent): Promise<void> {
    const r = event.result;
    const value: StoredReading = {
      status: r.status,
      plate: r.plate,
      plateFormat: r.plate_format,
      confidence: r.confidence,
      candidates: r.raw_candidates,
      processedAt: event.processed_at,
    };
    await this.redis.set(this.key(event.request_id), JSON.stringify(value), 'EX', this.config.readingTtlSeconds);
  }

  async get(requestId: string): Promise<StoredReading | null> {
    const raw = await this.redis.get(this.key(requestId));
    return raw ? (JSON.parse(raw) as StoredReading) : null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }

  private key(requestId: string) {
    return `${this.config.readingKeyPrefix}${requestId}`;
  }
}
