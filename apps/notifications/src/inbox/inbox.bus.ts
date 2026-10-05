import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { CONFIG, type AppConfig } from '../config/config.js';

export interface InboxItem {
  id: string;
  orderId: string;
  orderNumber: number | null;
  eventType: string;
  title: string;
  body: string;
  severity: 'info' | 'warning';
  createdAt: string;
  readAt: string | null;
}

const PREFIX = 'notifications:inbox:';

/**
 * Tempo real da caixa de entrada: Redis pub/sub entre réplicas (a réplica que ingere o evento
 * nem sempre é a que tem o SSE do usuário aberto). É só um "aviso": a verdade é a tabela, e o
 * cliente reconcilia com uma listagem ao reconectar — perder um aviso nunca perde a notificação.
 */
@Injectable()
export class InboxBus implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InboxBus.name);
  private pub!: Redis;
  private sub!: Redis;
  private readonly listeners = new Map<string, Set<(item: InboxItem) => void>>();

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const opts = { retryStrategy: (n: number) => Math.min(n * 500, 5_000), maxRetriesPerRequest: null };
    this.pub = new Redis(this.cfg.redisUrl, opts);
    this.sub = new Redis(this.cfg.redisUrl, opts);
    for (const r of [this.pub, this.sub]) r.on('error', (e) => this.logger.warn(`Redis: ${e.message}`));
    this.sub.on('message', (channel: string, raw: string) => {
      const set = this.listeners.get(channel.slice(PREFIX.length));
      if (!set) return;
      try {
        const item = JSON.parse(raw) as InboxItem;
        for (const fn of set) fn(item);
      } catch {
        this.logger.warn('Mensagem de pub/sub inválida descartada');
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.sub?.disconnect();
    await this.pub?.quit().catch(() => undefined);
  }

  /** Best-effort: falha aqui não desfaz a notificação já gravada. */
  async publish(recipient: string, item: InboxItem): Promise<void> {
    try {
      await this.pub.publish(PREFIX + recipient, JSON.stringify(item));
    } catch (err) {
      this.logger.warn(`Falha ao publicar no pub/sub: ${(err as Error).message}`);
    }
  }

  /** Stream de itens novos do destinatário; ao cancelar a inscrição, solta o canal Redis. */
  subscribe(recipient: string): Observable<InboxItem> {
    return new Observable<InboxItem>((subscriber) => {
      const fn = (item: InboxItem) => subscriber.next(item);
      let set = this.listeners.get(recipient);
      if (!set) {
        this.listeners.set(recipient, (set = new Set()));
        void this.sub.subscribe(PREFIX + recipient).catch((e) => this.logger.warn(`subscribe: ${e.message}`));
      }
      set.add(fn);
      return () => {
        set.delete(fn);
        if (set.size === 0) {
          this.listeners.delete(recipient);
          void this.sub.unsubscribe(PREFIX + recipient).catch(() => undefined);
        }
      };
    });
  }
}
