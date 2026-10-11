import { request } from 'node:https';
import { request as httpRequest } from 'node:http';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import amqp from 'amqplib';
import { Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config.js';
import { signWebhook } from './signature.js';
import { assertSafeWebhook } from './ssrf.js';

/** Aviso entregue ao consumidor: SEMPRE o mesmo, em qualquer transporte, e nunca com XML (spec §7.1). */
export interface DeliveryMessage {
  v: 1;
  /** Determinístico (`<subscriptionId>:<toNsu>`): o consumidor deduplica por ele. */
  messageId: string;
  companyCnpj: string;
  fromNsu: string;
  toNsu: string;
  emittedAt: string;
}

export interface DeliveryTarget {
  transport: 'WEBHOOK' | 'RABBITMQ' | 'REDIS_STREAM';
  tenantSlug: string;
  target: { url?: string };
  /** Segredo do webhook já decifrado. */
  secret: string | null;
}

/** Falha de entrega; `retryable=false` (ex.: 4xx do consumidor) manda direto para DEAD só se for erro de configuração. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

const WEBHOOK_TIMEOUT_MS = 10_000;

/** Routing key / stream por tenant: o consumidor só enxerga o que é dele (isolamento por nome, não por escolha). */
export const routingKey = (tenantSlug: string, cnpj: string) => `dfe.${tenantSlug}.${cnpj}`;
export const streamName = (tenantSlug: string) => `dfe:${tenantSlug}`;

@Injectable()
export class Transports implements OnApplicationShutdown {
  private readonly logger = new Logger(Transports.name);
  private redis: Redis | null = null;
  private rabbit: { conn: Awaited<ReturnType<typeof amqp.connect>>; ch: amqp.ConfirmChannel } | null = null;
  private rabbitConnecting: Promise<NonNullable<Transports['rabbit']>> | null = null;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  async onApplicationShutdown(): Promise<void> {
    await this.rabbit?.ch.close().catch(() => undefined);
    await this.rabbit?.conn.close().catch(() => undefined);
    this.redis?.disconnect();
  }

  async send(t: DeliveryTarget, msg: DeliveryMessage): Promise<void> {
    switch (t.transport) {
      case 'WEBHOOK':
        return this.webhook(t, msg);
      case 'RABBITMQ':
        return this.publishRabbit(t, msg);
      case 'REDIS_STREAM':
        return this.publishStream(t, msg);
    }
  }

  private async webhook(t: DeliveryTarget, msg: DeliveryMessage): Promise<void> {
    if (!t.target.url || !t.secret) throw new DeliveryError('Webhook sem URL ou segredo', false);
    const { url, address } = await assertSafeWebhook(t.target.url, this.cfg.allowInsecureWebhooks).catch((e: Error) => {
      throw new DeliveryError(`Destino recusado: ${e.message}`, false);
    });
    const body = JSON.stringify(msg);
    const send = url.protocol === 'https:' ? request : httpRequest;

    await new Promise<void>((resolve, reject) => {
      // Conecta no IP já validado; `servername`/Host mantêm o TLS e o roteamento do consumidor corretos.
      const req = send(
        {
          host: address,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          servername: url.hostname,
          timeout: WEBHOOK_TIMEOUT_MS,
          headers: {
            Host: url.host,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-Dfe-Signature': signWebhook(t.secret!, body),
            'X-Dfe-Message-Id': msg.messageId,
            'User-Agent': 'dfe-gateway/1',
          },
        },
        (res) => {
          res.resume(); // não lemos o corpo: só o status importa
          const s = res.statusCode ?? 0;
          // Redirecionamento NÃO é seguido (poderia levar a um destino interno).
          if (s >= 200 && s < 300) resolve();
          else reject(new DeliveryError(`Webhook respondeu HTTP ${s}`, !(s >= 400 && s < 500 && s !== 408 && s !== 429)));
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => reject(e instanceof DeliveryError ? e : new DeliveryError(`Falha de rede: ${e.message}`)));
      req.end(body);
    });
  }

  private async publishStream(t: DeliveryTarget, msg: DeliveryMessage): Promise<void> {
    if (!this.cfg.redisUrl) throw new DeliveryError('REDIS_URL não configurada neste gateway', false);
    this.redis ??= new Redis(this.cfg.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
    try {
      await this.redis.xadd(streamName(t.tenantSlug), 'MAXLEN', '~', String(this.cfg.streamMaxLen), '*', 'messageId', msg.messageId, 'payload', JSON.stringify(msg));
    } catch (e) {
      throw new DeliveryError(`Redis: ${(e as Error).message}`);
    }
  }

  private async publishRabbit(t: DeliveryTarget, msg: DeliveryMessage): Promise<void> {
    if (!this.cfg.rabbit) throw new DeliveryError('RABBITMQ_URL não configurada neste gateway', false);
    try {
      const { ch } = await this.rabbitChannel();
      await new Promise<void>((resolve, reject) => {
        ch.publish(
          this.cfg.rabbit!.exchange,
          routingKey(t.tenantSlug, msg.companyCnpj),
          Buffer.from(JSON.stringify(msg)),
          { persistent: true, contentType: 'application/json', messageId: msg.messageId, timestamp: Math.floor(Date.now() / 1000) },
          (err) => (err ? reject(err) : resolve()), // publisher confirm: só vale depois do ack do broker
        );
      });
    } catch (e) {
      this.rabbit = null;
      throw new DeliveryError(`RabbitMQ: ${(e as Error).message}`);
    }
  }

  private async rabbitChannel() {
    if (this.rabbit) return this.rabbit;
    this.rabbitConnecting ??= (async () => {
      const conn = await amqp.connect(this.cfg.rabbit!.url);
      conn.on('error', (e: Error) => this.logger.warn(`RabbitMQ: ${e.message}`));
      conn.on('close', () => (this.rabbit = null));
      const ch = await conn.createConfirmChannel();
      await ch.assertExchange(this.cfg.rabbit!.exchange, 'topic', { durable: true });
      this.rabbit = { conn, ch };
      return this.rabbit;
    })().finally(() => (this.rabbitConnecting = null));
    return this.rabbitConnecting;
  }
}
