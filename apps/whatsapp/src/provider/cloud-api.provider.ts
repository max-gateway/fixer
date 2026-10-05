import type { AppConfig } from '../config/config.js';
import { classifyMetaError } from './errors.js';
import {
  ProviderError,
  type OutboundMessage,
  type WhatsAppProvider,
} from './provider.js';

const TIMEOUT_MS = 10_000;

/** WhatsApp Cloud API (Meta). O token nunca é logado nem entra em mensagens de erro. */
export class CloudApiProvider implements WhatsAppProvider {
  private readonly url: string;

  constructor(
    private readonly cfg: AppConfig['meta'],
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  }

  async send(m: OutboundMessage): Promise<{ wamid: string }> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(this.payload(m)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (err) {
      // Timeout/rede: a Meta pode ter recebido. Reenvio é at-least-once; o risco de duplicata é aceito e raro.
      throw new ProviderError(`Falha de rede: ${(err as Error).name}`, true);
    }

    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: {
        code?: number;
        message?: string;
        error_data?: { details?: string };
      };
    };
    const wamid = json.messages?.[0]?.id;
    if (res.ok && wamid) return { wamid };

    const code = json.error?.code;
    const { retryable } = classifyMetaError(res.status, code);
    const retryAfter = Number(res.headers.get('retry-after'));
    const detail =
      json.error?.error_data?.details ?? json.error?.message ?? 'sem detalhe';
    throw new ProviderError(
      `HTTP ${res.status}: ${detail}`.slice(0, 500),
      retryable,
      code?.toString(),
      retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }

  private payload(m: OutboundMessage) {
    const base = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: m.to,
    };
    if (m.kind === 'TEXT') {
      // preview_url desligado: o link do portal já vem em template; texto livre não deve gerar preview surpresa.
      return {
        ...base,
        type: 'text',
        text: { body: m.body, preview_url: false },
      };
    }
    return {
      ...base,
      type: 'template',
      template: {
        name: m.template,
        language: { code: m.language },
        components: m.variables?.length
          ? [
              {
                type: 'body',
                parameters: m.variables.map((text) => ({ type: 'text', text })),
              },
            ]
          : [],
      },
    };
  }
}
