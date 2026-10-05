import { Injectable } from '@nestjs/common';

@Injectable()
export class PlateEventsConfig {
  readonly redisUrl = process.env.PLATE_READER_REDIS_URL ?? 'redis://localhost:6379/0';
  readonly streamName = process.env.PLATE_READER_STREAM ?? 'plate-reader:events';
  readonly consumerGroup = process.env.PLATE_READER_CONSUMER_GROUP ?? 'fixer-core';
  readonly consumerName =
    process.env.PLATE_READER_CONSUMER_NAME ?? `fixer-core-${process.pid}`;

  // Repasse do resultado do OCR ao frontend (PlateReadingsStore).
  readonly readingKeyPrefix = 'plate-reading:';
  readonly readingTtlSeconds = 600;

  // Após esse tempo sem ACK, uma mensagem entregue a outro consumer que
  // morreu é reivindicada por este consumer (evita perda de eventos por crash).
  readonly claimIdleMs = 30_000;
  readonly blockMs = 5_000;
  readonly batchSize = 10;
  readonly maxDeliveryAttempts = 5;
}
