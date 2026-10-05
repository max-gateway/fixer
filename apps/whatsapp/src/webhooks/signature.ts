import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Valida o header `X-Hub-Signature-256: sha256=<hex>` da Meta: HMAC-SHA256 do corpo BRUTO com o
 * app secret. Tem que ser o corpo exatamente como chegou (não o JSON re-serializado) e a comparação
 * é em tempo constante.
 */
export function verifySignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const [scheme, hex] = header.split('=');
  if (scheme !== 'sha256' || !hex || !/^[0-9a-f]{64}$/i.test(hex)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(hex, 'hex'));
}

export const sign = (rawBody: Buffer | string, appSecret: string) =>
  `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
