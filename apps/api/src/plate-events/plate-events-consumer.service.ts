import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { PlateEventsConfig } from './plate-events.config.js';
import { PlateEventsHandler } from './plate-events.handler.js';
import { PlateEventSchema, type PlateEvent } from './schema.js';

/**
 * Consome os eventos publicados pelo microservice `apps/plate-reader`
 * (Python) no Redis Stream `plate-reader:events`.
 *
 * Usa consumer group para permitir múltiplas réplicas do Fixer core
 * processando em paralelo, com retomada de onde parou em caso de restart
 * (o offset do grupo fica salvo no próprio Redis).
 *
 * Roda um loop de leitura contínuo em background a partir de onModuleInit;
 * onApplicationShutdown sinaliza o loop para parar e fecha a conexão Redis.
 */
@Injectable()
export class PlateEventsConsumerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PlateEventsConsumerService.name);
  private redis!: Redis;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly config: PlateEventsConfig,
    private readonly handler: PlateEventsHandler,
  ) {}

  async onModuleInit(): Promise<void> {
    this.redis = new Redis(this.config.redisUrl, {
      // Não trava o startup do Nest se o Redis ainda não estiver de pé;
      // as tentativas de reconexão seguem em background.
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });

    await this.ensureConsumerGroup();

    this.running = true;
    this.loopPromise = this.consumeLoop();
    this.logger.log(
      `Consumindo "${this.config.streamName}" como ${this.config.consumerName} ` +
        `(grupo ${this.config.consumerGroup})...`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
    }
    await this.redis.quit();
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      // "$" = só processa mensagens publicadas a partir de agora na primeira
      // vez que o grupo é criado; MKSTREAM cria o stream se ainda não
      // existir (ex.: plate-reader ainda não publicou nada).
      await this.redis.xgroup(
        'CREATE',
        this.config.streamName,
        this.config.consumerGroup,
        '$',
        'MKSTREAM',
      );
      this.logger.log(
        `Consumer group "${this.config.consumerGroup}" criado em "${this.config.streamName}".`,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('BUSYGROUP')) {
        // grupo já existe — normal em restarts.
        return;
      }
      throw err;
    }
  }

  private async consumeLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.reclaimStalePending();
        await this.consumeNewMessages();
      } catch (err) {
        this.logger.error('Erro no loop de consumo, tentando novamente', err as Error);
      }
    }
  }

  private parseStreamMessage(fields: string[]): PlateEvent | null {
    // XREADGROUP retorna os campos como array plano [k1, v1, k2, v2, ...];
    // o publisher do plate-reader grava um único campo "data" com o JSON
    // serializado.
    const dataIndex = fields.indexOf('data');
    if (dataIndex === -1 || fields.length <= dataIndex + 1) {
      this.logger.error(`Mensagem sem campo 'data', descartando: ${fields}`);
      return null;
    }
    const raw = fields[dataIndex + 1];
    try {
      const parsed = JSON.parse(raw);
      return PlateEventSchema.parse(parsed);
    } catch (err) {
      this.logger.error(`Payload inválido, descartando mensagem: ${raw}`, err as Error);
      return null;
    }
  }

  private async processMessage(id: string, fields: string[]): Promise<void> {
    const event = this.parseStreamMessage(fields);
    if (event === null) {
      // Payload malformado nunca vai processar com sucesso — ACK direto para
      // não ficar reentregando infinitamente (equivalente a uma dead-letter
      // implícita; considere mover para um stream de erro dedicado em produção).
      await this.redis.xack(this.config.streamName, this.config.consumerGroup, id);
      return;
    }

    await this.handler.handle(event);
    await this.redis.xack(this.config.streamName, this.config.consumerGroup, id);
  }

  /** Lê e processa novas mensagens entregues a este consumer. */
  private async consumeNewMessages(): Promise<void> {
    const response = await this.redis.xreadgroup(
      'GROUP',
      this.config.consumerGroup,
      this.config.consumerName,
      'COUNT',
      this.config.batchSize,
      'BLOCK',
      this.config.blockMs,
      'STREAMS',
      this.config.streamName,
      '>',
    );

    if (!response) return;

    for (const [, messages] of response as [string, [string, string[]][]][]) {
      for (const [id, fields] of messages) {
        try {
          await this.processMessage(id, fields);
        } catch (err) {
          this.logger.error(`Falha processando mensagem ${id}, será reentregue`, err as Error);
          // Não faz ACK — a mensagem fica pending e será reivindicada por
          // reclaimStalePending() (deste ou de outro consumer) após claimIdleMs.
        }
      }
    }
  }

  /**
   * Reivindica mensagens que ficaram "pending" (entregues mas nunca ACKed)
   * por tempo demais — cobre o caso de uma réplica que morreu no meio do
   * processamento. Mensagens com muitas tentativas de entrega são logadas
   * como suspeitas de poison message (considere mover para dead-letter).
   */
  private async reclaimStalePending(): Promise<void> {
    const [, claimed] = (await this.redis.xautoclaim(
      this.config.streamName,
      this.config.consumerGroup,
      this.config.consumerName,
      this.config.claimIdleMs,
      '0',
      'COUNT',
      this.config.batchSize,
    )) as [string, [string, string[]][], string[]];

    for (const [id, fields] of claimed) {
      const deliveryCount = await this.getDeliveryCount(id);
      if (deliveryCount > this.config.maxDeliveryAttempts) {
        this.logger.error(
          `Mensagem ${id} excedeu ${this.config.maxDeliveryAttempts} tentativas — ` +
            `possível poison message. ACKando sem processar (mova para dead-letter em produção).`,
        );
        await this.redis.xack(this.config.streamName, this.config.consumerGroup, id);
        continue;
      }

      try {
        await this.processMessage(id, fields);
      } catch (err) {
        this.logger.error(`Falha reprocessando mensagem reivindicada ${id}`, err as Error);
      }
    }
  }

  private async getDeliveryCount(id: string): Promise<number> {
    const pending = (await this.redis.xpending(
      this.config.streamName,
      this.config.consumerGroup,
      'IDLE',
      0,
      id,
      id,
      1,
    )) as unknown as [string, string, number, number][];
    return pending[0]?.[3] ?? 0;
  }
}
