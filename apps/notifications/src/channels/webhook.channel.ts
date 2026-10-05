import { createHmac } from 'node:crypto';
import type { WebhookEndpoint } from '../config/config.js';
import { DeliveryError, type ChannelProvider, type OutboundNotification } from './channel.js';

const TIMEOUT_MS = 5_000;

/** `recipient` é a URL do endpoint; o secret vem da config (nunca é gravado no banco). */
export class WebhookChannel implements ChannelProvider {
  readonly channel = 'webhook' as const;
  private readonly secrets: Map<string, string>;

  constructor(endpoints: WebhookEndpoint[]) {
    this.secrets = new Map(endpoints.map((e) => [e.url, e.secret]));
  }

  async send(n: OutboundNotification) {
    const secret = this.secrets.get(n.recipient);
    if (!secret) throw new DeliveryError(`Endpoint removido da configuração: ${n.recipient}`, false);

    const body = JSON.stringify(n.message.body);
    const timestamp = Math.floor(Date.now() / 1000);
    // Assinatura sobre "<timestamp>.<corpo>": o receptor valida a origem e recusa replays antigos.
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

    let res: Response;
    try {
      res = await fetch(n.recipient, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'fixer-notifications/1',
          'x-fixer-event-id': n.eventId,
          'x-fixer-delivery-id': n.id,
          'x-fixer-signature': `t=${timestamp},v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (err) {
      throw new DeliveryError(`Falha de rede: ${(err as Error).message}`, true);
    }

    if (res.ok) return { providerMessageId: res.headers.get('x-request-id') ?? undefined };

    const retryAfter = Number(res.headers.get('retry-after'));
    const transient = res.status >= 500 || res.status === 408 || res.status === 429;
    throw new DeliveryError(`HTTP ${res.status}`, transient, retryAfter > 0 ? retryAfter * 1000 : undefined);
  }
}
