import { DeliveryError, type ChannelProvider, type OutboundNotification } from './channel.js';

const TIMEOUT_MS = 5_000;

/**
 * Entrega via apps/whatsapp (serviço próprio, dono da fila e da conversa com a Meta). Aqui só
 * enfileiramos lá: o id da notificação vai como `Idempotency-Key`, então um retry nosso após
 * timeout nunca vira mensagem duplicada para o cliente.
 * `recipient` é o telefone do cliente; `message.body` é o pedido já pronto ({ type, template, variables, reference }).
 */
export class WhatsAppChannel implements ChannelProvider {
  readonly channel = 'whatsapp' as const;

  constructor(private readonly cfg: { url: string; apiKey: string }) {}

  async send(n: OutboundNotification) {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.url.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.apiKey}`,
          'idempotency-key': `notif-${n.id}`,
        },
        body: JSON.stringify({ ...(n.message.body as object), to: n.recipient }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (err) {
      throw new DeliveryError(`Falha de rede: ${(err as Error).message}`, true);
    }

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { providerMessageId: json.id };
    }
    const detail = (await res.json().catch(() => ({}))) as { message?: string };
    const retryAfter = Number(res.headers.get('retry-after'));
    // 401/403 = chave errada na config: transitório (corrige-se sem perder a notificação).
    const transient = res.status >= 500 || res.status === 408 || res.status === 429 || res.status === 401 || res.status === 403;
    throw new DeliveryError(`HTTP ${res.status}: ${detail.message ?? ''}`.trim(), transient, retryAfter > 0 ? retryAfter * 1000 : undefined);
  }
}
