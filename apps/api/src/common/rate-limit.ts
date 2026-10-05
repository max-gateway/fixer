import { HttpException } from '@nestjs/common';

/**
 * Janela deslizante em memória, por chave. Suficiente para frear abuso de um link
 * público dentro de uma instância (cada tenant roda 1 réplica da API); se escalar
 * para várias réplicas, trocar por contador no Redis.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now = Date.now()): void {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      throw new HttpException('Muitas ações em pouco tempo. Aguarde um instante.', 429);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.sweep(now);
  }

  private sweep(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
