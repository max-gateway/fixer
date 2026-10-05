import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DeliveryError, type ChannelProvider, type ChannelName, type RenderedMessage } from '../channels/channel.js';
import { CONFIG, type AppConfig } from '../config/config.js';
import { Database } from '../db/database.service.js';
import { Metrics } from '../health/metrics.service.js';
import { ChannelRegistry } from './channel-registry.js';
import { CircuitBreaker } from './circuit-breaker.js';

interface Claimed {
  id: string;
  event_id: string;
  channel: ChannelName;
  recipient: string;
  message: RenderedMessage;
  attempts: number;
  max_attempts: number;
}

/** Backoff exponencial com "full jitter" (evita que falhas simultâneas voltem todas no mesmo instante). */
export function backoffMs(attempt: number, baseMs: number, capMs: number, rand = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + rand() * (ceiling / 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STATE_GAUGE = { closed: 0, 'half-open': 1, open: 2 } as const;

/**
 * Worker de entrega. Cada réplica "reivindica" lotes com `FOR UPDATE SKIP LOCKED` (sem coordenação
 * extra) e coloca um lease em `locked_until`: se a réplica morrer no meio do envio, o lease expira e
 * outra pega a notificação — por isso a entrega é at-least-once; os provedores recebem o id da
 * notificação (Message-ID / X-Fixer-Delivery-Id) para o receptor deduplicar se quiser.
 *
 * Cada canal tem o seu circuit breaker (por réplica): canal com provedor fora do ar pausa e não
 * atrapalha os outros; as notificações dele ficam PENDING na fila e saem quando o circuito fecha.
 */
@Injectable()
export class Dispatcher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(Dispatcher.name);
  private readonly breakers = new Map<string, CircuitBreaker>();
  private running = false;
  private loop: Promise<void> | null = null;
  private lastCleanup = 0;

  constructor(
    private readonly db: Database,
    private readonly channels: ChannelRegistry,
    private readonly metrics: Metrics,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit(): void {
    this.running = true;
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop; // termina o lote em andamento antes de fechar o pool
  }

  private breaker(channel: string): CircuitBreaker {
    let b = this.breakers.get(channel);
    if (!b) this.breakers.set(channel, (b = new CircuitBreaker(this.cfg.dispatch.breaker)));
    return b;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let n = 0;
      try {
        n = await this.tick();
        await this.cleanupIfDue();
      } catch (err) {
        this.logger.error(`Ciclo de entrega falhou: ${(err as Error).message}`);
      }
      if (n === 0) await sleep(this.cfg.dispatch.pollMs);
    }
  }

  /** Reivindica e processa um lote por canal; devolve quantas notificações foram tratadas. */
  async tick(): Promise<number> {
    let total = 0;
    for (const channel of this.channels.names()) {
      const breaker = this.breaker(channel);
      this.metrics.breakerState.set({ channel }, STATE_GAUGE[breaker.state]);
      const limit = breaker.allowance(this.cfg.dispatch.batchSize);
      if (limit === 0) continue;

      const rows = await this.claim(channel, limit);
      if (rows.length > 0) breaker.beginProbe();
      await Promise.all(rows.map((r) => this.deliver(r, breaker)));
      total += rows.length;
    }
    return total;
  }

  private async claim(channel: string, limit: number): Promise<Claimed[]> {
    const { rows } = await this.db.query<Claimed>(
      `UPDATE notifications SET status = 'SENDING', attempts = attempts + 1,
              locked_until = now() + ($3 || ' milliseconds')::interval, updated_at = now()
        WHERE id IN (
          SELECT id FROM notifications
           WHERE channel = $1
             AND ((status = 'PENDING' AND next_attempt_at <= now())
               OR (status = 'SENDING' AND locked_until < now()))
           ORDER BY next_attempt_at
           LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING id, event_id, channel, recipient, message, attempts, max_attempts`,
      [channel, limit, String(this.cfg.dispatch.leaseMs)],
    );
    return rows;
  }

  private async deliver(n: Claimed, breaker: CircuitBreaker): Promise<void> {
    const provider: ChannelProvider | undefined = this.channels.get(n.channel);
    if (!provider) return this.fail(n, new DeliveryError(`Canal sem provedor configurado: ${n.channel}`, false), breaker);
    // Lease expirado repetidas vezes (crash no meio do envio): para de tentar.
    if (n.attempts > n.max_attempts) {
      return this.fail(n, new DeliveryError('Tentativas esgotadas (lease expirado)', false), breaker);
    }

    const stop = this.metrics.sendDuration.startTimer({ channel: n.channel });
    try {
      const { providerMessageId } = await provider.send({ id: n.id, eventId: n.event_id, recipient: n.recipient, message: n.message });
      stop();
      breaker.onSuccess();
      await this.db.query(
        `UPDATE notifications SET status = 'SENT', sent_at = now(), locked_until = NULL, last_error = NULL,
                provider_message_id = $2, updated_at = now() WHERE id = $1`,
        [n.id, providerMessageId ?? null],
      );
      this.metrics.sent.inc({ channel: n.channel, result: 'sent' });
    } catch (err) {
      stop();
      await this.fail(n, err instanceof DeliveryError ? err : new DeliveryError((err as Error).message, true), breaker);
    }
  }

  private async fail(n: Claimed, err: DeliveryError, breaker: CircuitBreaker): Promise<void> {
    if (err.retryable) breaker.onTransientFailure();
    else breaker.onPermanentFailure();

    const dead = !err.retryable || n.attempts >= n.max_attempts;
    const { backoffBaseMs, backoffCapMs } = this.cfg.dispatch;
    const delay = Math.max(err.retryAfterMs ?? 0, backoffMs(n.attempts, backoffBaseMs, backoffCapMs));
    this.logger[dead ? 'error' : 'warn'](
      `${dead ? 'DEAD' : 'retry'} ${n.channel} ${n.id} (tentativa ${n.attempts}/${n.max_attempts}): ${err.message}`,
    );
    await this.db.query(
      `UPDATE notifications SET status = $2, last_error = $3, locked_until = NULL,
              next_attempt_at = now() + ($4 || ' milliseconds')::interval, updated_at = now() WHERE id = $1`,
      [n.id, dead ? 'DEAD' : 'PENDING', err.message.slice(0, 1000), String(delay)],
    );
    this.metrics.sent.inc({ channel: n.channel, result: dead ? 'dead' : 'retry' });
  }

  /** Retenção (1x por hora por réplica): janela de dedup da inbox e notificações finalizadas antigas. */
  private async cleanupIfDue(): Promise<void> {
    if (Date.now() - this.lastCleanup < 3_600_000) return;
    this.lastCleanup = Date.now();
    await this.db.query(`DELETE FROM inbox WHERE received_at < now() - ($1 || ' days')::interval`, [String(this.cfg.inboxRetentionDays)]);
    await this.db.query(
      `DELETE FROM notifications WHERE status IN ('SENT','DEAD','SUPPRESSED') AND created_at < now() - ($1 || ' days')::interval`,
      [String(this.cfg.notificationRetentionDays)],
    );
  }
}
