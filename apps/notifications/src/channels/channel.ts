/** `inapp` é a caixa de entrada da equipe: nasce entregue (SENT) na ingestão e não passa pelo Dispatcher. */
export type ChannelName = 'email' | 'webhook' | 'whatsapp' | 'inapp';

/** Mensagem já renderizada, pronta para um canal. Persistida em `notifications.message`. */
export interface RenderedMessage {
  subject?: string;
  text?: string;
  html?: string;
  /** Webhook: o próprio evento. In-app: `{ severity, orderNumber }`; `subject` = título e `text` = corpo. */
  body?: unknown;
}

export interface OutboundNotification {
  id: string;
  eventId: string;
  recipient: string;
  message: RenderedMessage;
}

/** `retryable=false`: erro permanente (endereço inválido, 4xx) — vai direto para DEAD sem gastar tentativas. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Sugestão de espera do provedor (ex.: Retry-After). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Novo canal (SMS, WhatsApp, push...) = implementar esta interface e registrá-la no ChannelRegistry. */
export interface ChannelProvider {
  readonly channel: ChannelName;
  /** Retorna o id da mensagem no provedor; lança DeliveryError em falha. */
  send(n: OutboundNotification): Promise<{ providerMessageId?: string }>;
  close?(): Promise<void>;
}
