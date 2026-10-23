export class BulkheadFullError extends Error {
  constructor() {
    super('Limite de chamadas simultâneas ao catálogo atingido.');
    this.name = 'BulkheadFullError';
  }
}

export interface BulkheadOptions {
  maxConcurrent: number;
  /** Quantas chamadas esperam vaga (FIFO). Padrão 0: o excedente é recusado na hora. */
  maxQueue?: number;
}

/**
 * Limita as chamadas simultâneas ao catálogo para que uma plataforma lenta não esgote o pool da API do Fixer.
 * A vaga é liberada também quando a chamada falha.
 */
export class Bulkhead {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly o: BulkheadOptions) {}

  get inFlight(): number {
    return this.running;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.o.maxConcurrent) {
      if (this.queue.length >= (this.o.maxQueue ?? 0)) throw new BulkheadFullError();
      // A vaga é repassada por `release` (running não muda), então a ordem de chegada é preservada.
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.running++;
    }
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.running--;
    }
  }
}
