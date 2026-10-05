/**
 * Token bucket em memória (por réplica). Mantém o envio dentro do throughput do número na Meta
 * (80 msg/s no padrão) sem depender de coordenação entre réplicas: configure META_MAX_MPS por
 * réplica de forma que a soma fique abaixo do limite.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = ratePerSec;
    this.last = now();
  }

  /** Quantos envios podem sair agora (até `want`); consome o que devolve. */
  take(want: number): number {
    const t = this.now();
    this.tokens = Math.min(
      this.ratePerSec,
      this.tokens + ((t - this.last) / 1000) * this.ratePerSec,
    );
    this.last = t;
    const n = Math.min(want, Math.floor(this.tokens));
    this.tokens -= n;
    return n;
  }

  /** Devolve tokens de um `take` que não foi usado por inteiro (a fila tinha menos mensagens). */
  refund(n: number): void {
    this.tokens = Math.min(this.ratePerSec, this.tokens + n);
  }
}
