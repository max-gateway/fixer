import { createHmac, timingSafeEqual } from 'node:crypto';

/** `X-Dfe-Signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, t + "." + body))>` (docs/specs/dfe-gateway.md §7.2). */
export function signWebhook(secret: string, body: string, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${nowSec}.${body}`).digest('hex');
  return `t=${nowSec},v1=${mac}`;
}

/**
 * Verificação para o consumidor (exportada para os clientes copiarem e para os testes): rejeita assinatura
 * errada e timestamp com mais de `toleranceSec` de diferença (anti-replay). Comparação em tempo constante.
 */
export function verifyWebhook(secret: string, body: string, header: string, nowSec: number = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(m[2]!, 'hex'));
}
