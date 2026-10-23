export type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuito aberto: a plataforma de catálogo está indisponível.');
    this.name = 'CircuitOpenError';
  }
}

export interface BreakerOptions {
  /** Falhas CONSECUTIVAS que abrem o circuito. */
  failureThreshold: number;
  /** Quanto o circuito fica aberto antes de deixar passar uma sonda. */
  openMs: number;
  now?: () => number;
  /** Quais erros contam como falha do serviço (padrão: todos). Erro do chamador (4xx) deve devolver false. */
  isFailure?: (err: unknown) => boolean;
}

/**
 * Disjuntor: fechado repassa; após N falhas consecutivas abre e recusa sem chamar; passado `openMs` deixa passar UMA sonda
 * (meio aberto): sucesso fecha, falha reabre e reinicia a espera. Resposta do serviço que não é falha dele (4xx) conta como saudável.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private current: BreakerState = 'closed';
  private probing = false;
  private readonly now: () => number;
  private readonly isFailure: (err: unknown) => boolean;

  constructor(private readonly o: BreakerOptions) {
    this.now = o.now ?? Date.now;
    this.isFailure = o.isFailure ?? (() => true);
  }

  get state(): BreakerState {
    return this.current;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.current === 'open') {
      if (this.now() - this.openedAt < this.o.openMs) throw new CircuitOpenError();
      this.current = 'half-open';
      this.probing = false;
    }
    if (this.current === 'half-open') {
      if (this.probing) throw new CircuitOpenError();
      this.probing = true;
    }
    try {
      const result = await fn();
      this.onHealthy();
      return result;
    } catch (err) {
      if (this.isFailure(err)) this.onFailure();
      else this.onHealthy();
      throw err;
    }
  }

  private onHealthy() {
    this.failures = 0;
    this.probing = false;
    this.current = 'closed';
  }

  private onFailure() {
    this.failures++;
    this.probing = false;
    if (this.current === 'half-open' || this.failures >= this.o.failureThreshold) {
      this.current = 'open';
      this.openedAt = this.now();
    }
  }
}

/** Um disjuntor por chave (organização): a falha de uma oficina não derruba a busca das outras. */
export class BreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly o: BreakerOptions) {}

  for(key: string): CircuitBreaker {
    let b = this.breakers.get(key);
    if (!b) this.breakers.set(key, (b = new CircuitBreaker(this.o)));
    return b;
  }
}
