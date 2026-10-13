import { hostname } from 'node:os';
import { Inject, Injectable, Logger, Optional, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { EnvelopeSchema, ORDER_CODE_RECEIVED, OrderCodeReceivedSchema } from './inbound-event.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { TenantDirectory } from '../tenancy/tenant-directory.service.js';
import { WhatsappLinkService } from './link.service.js';

type StreamEntry = [id: string, fields: string[]];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Consome `fixer:whatsapp-inbound` com consumer group (várias réplicas, retomada após restart,
 * reivindicação de mensagens órfãs via XAUTOCLAIM).
 *
 * Política de falha (a mesma do consumidor de notificações):
 *  - JSON ilegível / contrato inválido / versão desconhecida / outro tenant -> DLQ + ACK (nunca vai funcionar);
 *  - tipo de evento desconhecido -> ACK e ignora (outro produtor pode publicar no mesmo stream no futuro);
 *  - falha transitória (banco fora do ar) -> sem ACK; fica pendente e é reentregue;
 *  - mais de `maxDeliveries` entregas -> DLQ + ACK (poison message não trava o grupo).
 * A DLQ (`<stream>:dlq`) guarda o original + motivo para inspeção e replay manual.
 */
@Injectable()
export class WhatsappInboundConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WhatsappInboundConsumer.name);
  private readonly stream = process.env.WHATSAPP_INBOUND_STREAM ?? 'fixer:whatsapp-inbound';
  private readonly dlq = `${this.stream}:dlq`;
  private readonly group = process.env.WHATSAPP_INBOUND_GROUP ?? 'fixer-api';
  private readonly consumer = `${hostname()}-${process.pid}`;
  /** Instalação legada (uma oficina por instância) só aceita eventos do seu slug; no modo compartilhado vale o código. */
  private readonly tenant = process.env.TENANT_SLUG;
  private readonly batchSize = 20;
  private readonly blockMs = 5_000;
  private readonly claimIdleMs = 60_000;
  private readonly maxDeliveries = 5;
  /** Conexão dedicada às leituras bloqueantes (XREADGROUP BLOCK); comandos usam `cmd`. */
  private reader!: Redis;
  private cmd!: Redis;
  private running = false;
  private loop: Promise<void> | null = null;
  private lastPurge = 0;

  constructor(
    private readonly link: WhatsappLinkService,
    /** Descobre a organização dona do código da ordem. Sem ele (testes), o evento é tratado na organização do contexto. */
    @Optional() @Inject(TenantDirectory) private readonly directory: TenantDirectory | null = null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.WHATSAPP_INBOUND_ENABLED === 'false') return;
    const url = process.env.REDIS_URL ?? process.env.PLATE_READER_REDIS_URL ?? 'redis://localhost:6379/0';
    const opts = { retryStrategy: (n: number) => Math.min(n * 500, 5_000), maxRetriesPerRequest: null };
    this.reader = new Redis(url, opts);
    this.cmd = new Redis(url, opts);
    for (const r of [this.reader, this.cmd]) r.on('error', (e) => this.logger.warn(`Redis: ${e.message}`));

    // Sem await no boot da API: Redis fora do ar não pode impedir a API de subir.
    this.running = true;
    this.loop = this.run();
    this.logger.log(`Consumindo "${this.stream}" como ${this.consumer}.`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
    this.reader?.disconnect();
    await this.cmd?.quit().catch(() => undefined);
  }

  private async ensureGroup(): Promise<void> {
    try {
      // Começa em "0": eventos publicados antes do primeiro boot da API também são entregues.
      await this.cmd.xgroup('CREATE', this.stream, this.group, '0', 'MKSTREAM');
      this.logger.log(`Grupo "${this.group}" criado em "${this.stream}".`);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err;
    }
  }

  private async run(): Promise<void> {
    let groupReady = false;
    while (this.running) {
      try {
        if (!groupReady) {
          await this.ensureGroup();
          groupReady = true;
        }
        await this.reclaimOrphans();
        await this.readNew();
        await this.purgeIfDue();
      } catch (err) {
        this.logger.error(`Loop de consumo falhou: ${(err as Error).message}`);
        await sleep(1_000); // evita busy-loop se o Redis ou o banco estiverem fora
      }
    }
  }

  private async readNew(): Promise<void> {
    const res = (await this.reader.xreadgroup(
      'GROUP', this.group, this.consumer,
      'COUNT', this.batchSize, 'BLOCK', this.blockMs,
      'STREAMS', this.stream, '>',
    )) as [string, StreamEntry[]][] | null;
    if (!res) return;
    for (const [, entries] of res) for (const entry of entries) await this.handle(entry);
  }

  /** Mensagens entregues a um consumer que morreu antes do ACK. */
  private async reclaimOrphans(): Promise<void> {
    const [, entries] = (await this.cmd.xautoclaim(
      this.stream, this.group, this.consumer, this.claimIdleMs, '0', 'COUNT', this.batchSize,
    )) as [string, StreamEntry[], string[]];

    for (const entry of entries) {
      if ((await this.deliveryCount(entry[0])) > this.maxDeliveries) {
        await this.deadLetter(entry, `excedeu ${this.maxDeliveries} entregas`);
        continue;
      }
      await this.handle(entry);
    }
  }

  private async handle([id, fields]: StreamEntry): Promise<void> {
    const raw = fields[fields.indexOf('data') + 1];
    let json: unknown;
    try {
      json = JSON.parse(raw ?? '');
    } catch {
      return this.deadLetter([id, fields], 'JSON inválido');
    }

    const envelope = EnvelopeSchema.safeParse(json);
    if (!envelope.success) return this.deadLetter([id, fields], `envelope inválido: ${envelope.error.issues[0]?.message}`);
    if (envelope.data.version !== 1) return this.deadLetter([id, fields], `versão ${envelope.data.version} desconhecida`);
    if (envelope.data.type !== ORDER_CODE_RECEIVED) {
      this.logger.debug(`Evento ${envelope.data.type} ignorado (sem tratamento aqui)`);
      return void (await this.cmd.xack(this.stream, this.group, id));
    }

    const parsed = OrderCodeReceivedSchema.safeParse(json);
    if (!parsed.success) return this.deadLetter([id, fields], `contrato inválido: ${parsed.error.issues[0]?.message}`);
    const event = parsed.data;
    if (this.tenant && event.tenant !== this.tenant) {
      return this.deadLetter([id, fields], `tenant "${event.tenant}" não é "${this.tenant}"`);
    }

    try {
      // O código da ordem é único no sistema todo: ele diz de qual organização é a ordem.
      const orgId = this.directory ? await this.directory.orgForLinkCode(event.data.code) : null;
      if (this.directory && !orgId) {
        // Código inexistente: sem organização não há onde registrar nada. Silencioso (não vira oráculo de códigos).
        this.logger.log(`order_code_received ${event.id} -> unknown_code`);
        return void (await this.cmd.xack(this.stream, this.group, id));
      }
      const outcome = await (orgId ? TenantContext.run(orgId, () => this.link.handle(event)) : this.link.handle(event));
      // Sem telefone nem código no log: PII e (quase) credencial.
      this.logger.log(`order_code_received ${event.id} -> ${outcome}`);
      await this.cmd.xack(this.stream, this.group, id);
    } catch (err) {
      // Sem ACK: reentrega via XAUTOCLAIM. O inbox garante que reprocessar é seguro.
      this.logger.error(`Falha ao processar ${event.id} (stream ${id}); será reentregue: ${(err as Error).message}`);
    }
  }

  private async deadLetter([id, fields]: StreamEntry, reason: string): Promise<void> {
    this.logger.error(`DLQ: mensagem ${id} — ${reason}`);
    await this.cmd.xadd(this.dlq, '*', 'reason', reason, 'originalId', id, 'failedAt', new Date().toISOString(), ...fields);
    await this.cmd.xack(this.stream, this.group, id);
  }

  private async deliveryCount(id: string): Promise<number> {
    const rows = (await this.cmd.xpending(this.stream, this.group, id, id, 1)) as [string, string, number, number][];
    return rows[0]?.[3] ?? 0;
  }

  private async purgeIfDue(): Promise<void> {
    if (Date.now() - this.lastPurge < 3_600_000) return;
    this.lastPurge = Date.now();
    const n = await this.link.purgeProcessed();
    if (n > 0) this.logger.log(`Inbox: ${n} eventos antigos removidos.`);
  }
}
