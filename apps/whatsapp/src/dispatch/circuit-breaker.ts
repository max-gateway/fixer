export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Falhas transitórias consecutivas que abrem o circuito. */
  threshold: number;
  /** Espera inicial com o circuito aberto; dobra a cada reabertura até `maxCooldownMs`. */
  cooldownMs: number;
  maxCooldownMs: number;
}

/**
 * Circuit breaker de um canal. Provedor fora do ar não deve consumir o lote inteiro até o timeout
 * (nem ser martelado): após `threshold` falhas seguidas o canal pausa; passado o cooldown, deixa passar
 * UMA tentativa de teste (half-open). Sucesso fecha; falha reabre com cooldown maior.
 * Só falhas transitórias contam: erro permanente (4xx) é problema da mensagem, não do provedor.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private cooldown: number;
  private probing = false;

  constructor(
    private readonly opts: BreakerOptions,
    private readonly now: () => number = Date.now,
  ) {
    this.cooldown = opts.cooldownMs;
  }

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.cooldown ? 'half-open' : 'open';
  }

  /** Quantas mensagens podem ser reivindicadas agora (lote cheio, 1 de teste, ou nenhuma). */
  allowance(batch: number): number {
    switch (this.state) {
      case 'closed':
        return batch;
      case 'half-open':
        return this.probing ? 0 : 1;
      default:
        return 0;
    }
  }

  /** Marca que a tentativa de teste foi disparada (evita duas sondas simultâneas). */
  beginProbe(): void {
    if (this.state === 'half-open') this.probing = true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.cooldown = this.opts.cooldownMs;
    this.probing = false;
  }

  onTransientFailure(): void {
    if (this.state === 'half-open') {
      this.cooldown = Math.min(this.cooldown * 2, this.opts.maxCooldownMs);
      this.openedAt = this.now();
      this.probing = false;
      return;
    }
    if (++this.failures >= this.opts.threshold && this.openedAt === null)
      this.openedAt = this.now();
  }

  /** Falha permanente não diz nada sobre a saúde do provedor, mas encerra uma sonda pendente. */
  onPermanentFailure(): void {
    if (this.state === 'half-open') this.onSuccess(); // o provedor respondeu: está de pé
  }
}
