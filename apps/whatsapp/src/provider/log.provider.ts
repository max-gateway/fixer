import { Logger } from '@nestjs/common';
import type { OutboundMessage, WhatsAppProvider } from './provider.js';

/** Desenvolvimento: não fala com a Meta, só registra. O telefone sai mascarado do log. */
export class LogProvider implements WhatsAppProvider {
  private readonly logger = new Logger('LogProvider');

  async send(m: OutboundMessage) {
    const what =
      m.kind === 'TEMPLATE'
        ? `template=${m.template} vars=${JSON.stringify(m.variables)}`
        : `texto="${m.body}"`;
    this.logger.log(`[whatsapp:log] para=***${m.to.slice(-4)} ${what}`);
    return { wamid: `log.${m.id}` };
  }
}
