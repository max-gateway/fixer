export interface OutboundMessage {
  /** Id interno (messages.id): vai no log e serve de correlação, a Meta não o usa. */
  id: string;
  to: string;
  kind: 'TEMPLATE' | 'TEXT';
  template?: string;
  language?: string;
  variables?: string[];
  body?: string;
}

/** `retryable=false`: erro permanente (número sem WhatsApp, template inválido) — vai direto para DEAD. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Código do provedor (ex.: "131026"), guardado em messages.last_error_code. */
    readonly code?: string,
    /** Sugestão de espera do provedor (Retry-After). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface WhatsAppProvider {
  /** Retorna o id da mensagem no provedor (wamid); lança ProviderError em falha. */
  send(m: OutboundMessage): Promise<{ wamid: string }>;
}

export const PROVIDER = Symbol('PROVIDER');
