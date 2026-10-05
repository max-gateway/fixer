import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import type { AppConfig } from '../config/config.js';
import { DeliveryError, type ChannelProvider, type OutboundNotification } from './channel.js';

/** SMTP real (EMAIL_TRANSPORT=smtp) ou "log" para desenvolvimento. */
export class EmailChannel implements ChannelProvider {
  readonly channel = 'email' as const;
  private readonly logger = new Logger('EmailChannel');
  private readonly transporter: Transporter | null;

  constructor(private readonly cfg: AppConfig['email']) {
    this.transporter =
      cfg.transport === 'smtp'
        ? createTransport({ url: cfg.smtpUrl, pool: true, connectionTimeout: 10_000, socketTimeout: 20_000 } as SMTPPool.Options)
        : null;
  }

  async send(n: OutboundNotification) {
    const { subject, text, html } = n.message;
    if (!this.transporter) {
      this.logger.log(`[email:log] para=${n.recipient} assunto="${subject}"\n${text}`);
      return { providerMessageId: `log-${n.id}` };
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.cfg.from,
        to: n.recipient,
        subject,
        text,
        html,
        // O id da notificação vira o Message-ID: um reenvio após timeout fica rastreável.
        messageId: `<${n.id}@notifications.fixer>`,
      });
      return { providerMessageId: info.messageId };
    } catch (err) {
      const code = (err as { responseCode?: number }).responseCode;
      // 5xx do servidor SMTP = rejeição definitiva (caixa inexistente etc.); o resto é transitório.
      throw new DeliveryError((err as Error).message, !(code && code >= 500 && code < 600));
    }
  }

  async close() {
    this.transporter?.close();
  }
}
