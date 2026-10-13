import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { z } from 'zod';
import { MembershipService } from '../tenancy/membership.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { ControlPlaneConfig } from './control-plane.config.js';
import { LicenseService } from './license.service.js';
import { ProvisioningService } from './provisioning.service.js';

/** Envelope publicado pelo control plane (`mg.control-plane`, routing key `<evento>.v1`). `tenantId` é a organização. */
const Envelope = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  type: z.string().min(1),
  tenantId: z.string().uuid(),
  correlationId: z.string().optional(),
  data: z.record(z.unknown()).default({}),
});
export type ControlPlaneEvent = z.infer<typeof Envelope>;

const BINDINGS = ['organization.created.v1', 'subscription.*.v1', 'entitlements.changed.v1', 'identity.member_ready.v1'];
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5_000;

/**
 * Mantém o Fixer alinhado ao control plane da Max Gateway:
 *  - `organization.created`: grava o perfil (dono) da organização;
 *  - eventos de assinatura/licença DO NOSSO PRODUTO: garantem papéis iniciais (no início do trial) e atualizam a licença
 *    com o snapshot assinado, que é a fonte da verdade (o evento só avisa que algo mudou).
 * Entrega pelo menos uma vez e fora de ordem: tudo aqui é idempotente. Falha reprocessa; esgotadas as tentativas vai para a DLQ.
 */
@Injectable()
export class ControlPlaneEventsConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ControlPlaneEventsConsumer.name);
  private conn?: ChannelModel;
  private ch?: Channel;
  private stopped = false;
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly cfg: ControlPlaneConfig,
    private readonly provisioning: ProvisioningService,
    private readonly license: LicenseService,
    private readonly membership: MembershipService,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.enabled) {
      this.logger.log('Integração com o control plane desligada (falta CONTROL_PLANE_URL, CONTROL_PLANE_API_KEY ou RABBITMQ_URL).');
      return;
    }
    void this.connectLoop(); // sem await: RabbitMQ fora do ar não pode impedir a API de subir
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    await this.ch?.close().catch(() => undefined);
    await this.conn?.close().catch(() => undefined);
  }

  private async connectLoop(): Promise<void> {
    for (let delay = 1_000; !this.stopped; delay = Math.min(delay * 2, 30_000)) {
      try {
        await this.connect();
        return;
      } catch (err) {
        this.logger.warn(`RabbitMQ indisponível (${(err as Error).message}); nova tentativa em ${delay} ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async connect(): Promise<void> {
    const conn = await amqp.connect(this.cfg.rabbitUrl!);
    const ch = await conn.createChannel();
    await ch.assertExchange(this.cfg.exchange, 'topic', { durable: true });
    await ch.assertQueue(`${this.cfg.queue}.dlq`, { durable: true });
    await ch.assertQueue(this.cfg.queue, { durable: true });
    for (const key of BINDINGS) await ch.bindQueue(this.cfg.queue, this.cfg.exchange, key);
    await ch.prefetch(10);
    conn.on('error', (e) => this.logger.warn(`RabbitMQ: ${e.message}`));
    conn.on('close', () => {
      this.conn = this.ch = undefined;
      if (!this.stopped) {
        this.logger.warn('Conexão com o RabbitMQ caiu; reconectando');
        void this.connectLoop();
      }
    });
    await ch.consume(this.cfg.queue, (msg) => msg && void this.onMessage(ch, msg));
    this.conn = conn;
    this.ch = ch;
    this.logger.log(`Consumindo ${this.cfg.exchange} na fila ${this.cfg.queue}.`);
  }

  private async onMessage(ch: Channel, msg: ConsumeMessage): Promise<void> {
    let event: ControlPlaneEvent;
    try {
      event = Envelope.parse(JSON.parse(msg.content.toString()));
    } catch (err) {
      this.logger.error(`Mensagem ilegível para a DLQ: ${(err as Error).message}`);
      ch.sendToQueue(`${this.cfg.queue}.dlq`, msg.content, { persistent: true, headers: { reason: 'envelope inválido' } });
      return ch.ack(msg);
    }
    try {
      await this.handle(event);
      this.attempts.delete(event.id);
      ch.ack(msg);
    } catch (err) {
      const n = (this.attempts.get(event.id) ?? 0) + 1;
      this.logger.error(`Evento ${event.type} (${event.id}) falhou, tentativa ${n}/${MAX_ATTEMPTS}: ${(err as Error).message}`);
      if (n >= MAX_ATTEMPTS) {
        this.attempts.delete(event.id);
        ch.sendToQueue(`${this.cfg.queue}.dlq`, msg.content, { persistent: true, headers: { reason: (err as Error).message.slice(0, 200) } });
        return ch.ack(msg);
      }
      this.attempts.set(event.id, n);
      setTimeout(() => (this.ch === ch ? ch.nack(msg, false, true) : undefined), RETRY_DELAY_MS);
    }
  }

  /** Aplica um evento. Público para teste: não depende do RabbitMQ. */
  async handle(event: ControlPlaneEvent): Promise<'provisioned' | 'refreshed' | 'member' | 'ignored'> {
    return TenantContext.run(event.tenantId, async () => {
      const type = event.type.replace(/\.v\d+$/, '');
      if (type === 'organization.created') {
        await this.provisioning.provision({ slug: str(event.data.slug), name: str(event.data.legalName), ownerEmail: str(event.data.ownerEmail) });
        return 'provisioned';
      }
      if (type === 'identity.member_ready') {
        // Membro da organização (não é por produto): quem participa de qual oficina vem daqui, não do claim do token.
        const keycloakId = str(event.data.keycloakSub);
        const email = str(event.data.email);
        if (!keycloakId || !email) return 'ignored';
        await this.membership.record({ keycloakId, email, role: str(event.data.role) ?? 'member' });
        return 'member';
      }
      const ours = event.data.product === this.cfg.product;
      if (ours && type === 'subscription.trial_started') await this.provisioning.provision();
      if (ours && (type.startsWith('subscription.') || type === 'entitlements.changed')) {
        await this.license.refresh();
        return 'refreshed';
      }
      return ours && type === 'subscription.trial_started' ? 'provisioned' : 'ignored';
    });
  }
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
