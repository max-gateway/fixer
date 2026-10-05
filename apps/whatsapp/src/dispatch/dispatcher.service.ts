import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { Database } from '../db/database.service.js';
import { Metrics } from '../health/metrics.service.js';
import {
  PROVIDER,
  ProviderError,
  type WhatsAppProvider,
} from '../provider/provider.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { TokenBucket } from './rate-limiter.js';

interface Claimed {
  id: string;
  to_phone: string;
  kind: 'TEMPLATE' | 'TEXT';
  template: string | null;
  language: string | null;
  variables: string[];
  body: string | null;
  attempts: number;
  max_attempts: number;
}

/** Backoff exponencial com "full jitter" (evita que falhas simultâneas voltem todas no mesmo instante). */
export function backoffMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  rand = Math.random,
): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + rand() * (ceiling / 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STATE_GAUGE = { closed: 0, 'half-open': 1, open: 2 } as const;

/**
 * Worker de entrega. Cada réplica reivindica lotes com `FOR UPDATE SKIP LOCKED` e põe um lease em
 * `locked_until`: se a réplica morrer no meio do envio, o lease expira e outra pega a mensagem
 * (at-least-once). Protege o provedor com circuit breaker e respeita o throughput do número com um
 * token bucket. Mensagens não enviadas ficam QUEUED e saem quando o circuito fecha.
 */
@Injectable()
export class Dispatcher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(Dispatcher.name);
  private readonly breaker: CircuitBreaker;
  private readonly bucket: TokenBucket;
  private running = false;
  private loop: Promise<void> | null = null;
  private lastCleanup = 0;

  constructor(
    private readonly db: Database,
    private readonly metrics: Metrics,
    @Inject(PROVIDER) private readonly provider: WhatsAppProvider,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {
    this.breaker = new CircuitBreaker(cfg.dispatch.breaker);
    this.bucket = new TokenBucket(cfg.meta.maxMps);
  }

  onModuleInit(): void {
    this.running = true;
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop; // termina o lote em andamento antes de fechar o pool
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

  /** Reivindica e processa um lote; devolve quantas mensagens foram tratadas. */
  async tick(): Promise<number> {
    this.metrics.breakerState.set(STATE_GAUGE[this.breaker.state]);
    const allowed = this.breaker.allowance(this.cfg.dispatch.batchSize);
    if (allowed === 0) return 0;
    const tokens = this.bucket.take(allowed);
    if (tokens === 0) return 0;

    const rows = await this.claim(tokens);
    this.bucket.refund(tokens - rows.length);
    if (rows.length > 0) this.breaker.beginProbe();
    await Promise.all(rows.map((r) => this.deliver(r)));
    return rows.length;
  }

  private async claim(limit: number): Promise<Claimed[]> {
    const { rows } = await this.db.query<Claimed>(
      `UPDATE messages SET status = 'SENDING', attempts = attempts + 1,
              locked_until = now() + ($2 || ' milliseconds')::interval, updated_at = now()
        WHERE id IN (
          SELECT id FROM messages
           WHERE (status = 'QUEUED' AND next_attempt_at <= now())
              OR (status = 'SENDING' AND locked_until < now())
           ORDER BY next_attempt_at
           LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id, to_phone, kind, template, language, variables, body, attempts, max_attempts`,
      [limit, String(this.cfg.dispatch.leaseMs)],
    );
    return rows;
  }

  private async deliver(m: Claimed): Promise<void> {
    // Lease expirado repetidas vezes (crash no meio do envio): para de tentar.
    if (m.attempts > m.max_attempts) {
      return this.fail(
        m,
        new ProviderError('Tentativas esgotadas (lease expirado)', false),
      );
    }

    // Reconfere na hora do envio: o cliente pode ter pedido PARAR depois do enfileiramento.
    const contact = (
      await this.db.query<{ opt_status: string; last_inbound_at: Date | null }>(
        'SELECT opt_status, last_inbound_at FROM contacts WHERE phone = $1',
        [m.to_phone],
      )
    ).rows[0];
    if (contact?.opt_status === 'OPTED_OUT') {
      await this.db.query(
        `UPDATE messages SET status = 'SUPPRESSED', locked_until = NULL, last_error = 'opt-out', updated_at = now() WHERE id = $1`,
        [m.id],
      );
      this.metrics.attempts.inc({ result: 'suppressed' });
      return;
    }
    if (m.kind === 'TEXT') {
      const last = contact?.last_inbound_at;
      if (!last || Date.now() - last.getTime() > this.cfg.serviceWindowMs) {
        return this.fail(
          m,
          new ProviderError(
            'Fora da janela de 24h: só template',
            false,
            'WINDOW_CLOSED',
          ),
        );
      }
    }

    const stop = this.metrics.sendDuration.startTimer();
    try {
      const { wamid } = await this.provider.send({
        id: m.id,
        to: m.to_phone,
        kind: m.kind,
        template: m.template ?? undefined,
        language: m.language ?? undefined,
        variables: m.variables,
        body: m.body ?? undefined,
      });
      stop();
      this.breaker.onSuccess();
      // O webhook de status pode chegar antes deste UPDATE; por isso só avança de SENDING -> SENT
      // e nunca regride um DELIVERED/READ que o webhook já tenha gravado.
      await this.db.query(
        `UPDATE messages SET wamid = $2, locked_until = NULL, last_error = NULL, last_error_code = NULL,
                sent_at = COALESCE(sent_at, now()), updated_at = now(),
                status = CASE WHEN status = 'SENDING' THEN 'SENT' ELSE status END
          WHERE id = $1`,
        [m.id, wamid],
      );
      this.metrics.attempts.inc({ result: 'sent' });
    } catch (err) {
      stop();
      await this.fail(
        m,
        err instanceof ProviderError
          ? err
          : new ProviderError((err as Error).message, true),
      );
    }
  }

  private async fail(m: Claimed, err: ProviderError): Promise<void> {
    if (err.retryable) this.breaker.onTransientFailure();
    else this.breaker.onPermanentFailure();

    const dead = !err.retryable || m.attempts >= m.max_attempts;
    const { backoffBaseMs, backoffCapMs } = this.cfg.dispatch;
    const delay = Math.max(
      err.retryAfterMs ?? 0,
      backoffMs(m.attempts, backoffBaseMs, backoffCapMs),
    );
    this.logger[dead ? 'error' : 'warn'](
      `${dead ? 'DEAD' : 'retry'} ${m.id} (tentativa ${m.attempts}/${m.max_attempts}) [${err.code ?? '-'}]: ${err.message}`,
    );
    await this.db.query(
      `UPDATE messages SET status = $2, last_error = $3, last_error_code = $4, locked_until = NULL,
              next_attempt_at = now() + ($5 || ' milliseconds')::interval, updated_at = now() WHERE id = $1`,
      [
        m.id,
        dead ? 'DEAD' : 'QUEUED',
        err.message.slice(0, 1000),
        err.code ?? null,
        String(delay),
      ],
    );
    this.metrics.attempts.inc({ result: dead ? 'dead' : 'retry' });
  }

  /** Retenção (1x por hora por réplica). */
  private async cleanupIfDue(): Promise<void> {
    if (Date.now() - this.lastCleanup < 3_600_000) return;
    this.lastCleanup = Date.now();
    const { messages, webhookEvents, inbound } = this.cfg.retentionDays;
    await this.db.query(
      `DELETE FROM messages WHERE status IN ('SENT','DELIVERED','READ','FAILED','DEAD','SUPPRESSED')
          AND created_at < now() - ($1 || ' days')::interval`,
      [String(messages)],
    );
    await this.db.query(
      `DELETE FROM webhook_events WHERE received_at < now() - ($1 || ' days')::interval`,
      [String(webhookEvents)],
    );
    await this.db.query(
      `DELETE FROM inbound_messages WHERE received_at < now() - ($1 || ' days')::interval`,
      [String(inbound)],
    );
  }
}
