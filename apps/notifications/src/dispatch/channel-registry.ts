import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { ChannelName, ChannelProvider } from '../channels/channel.js';
import { EmailChannel } from '../channels/email.channel.js';
import { WebhookChannel } from '../channels/webhook.channel.js';
import { WhatsAppChannel } from '../channels/whatsapp.channel.js';
import { CONFIG, type AppConfig } from '../config/config.js';

/** Único lugar que conhece os provedores concretos. Novo canal = registrar aqui. */
@Injectable()
export class ChannelRegistry implements OnApplicationShutdown {
  private readonly providers: Map<ChannelName, ChannelProvider>;

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    this.providers = new Map<ChannelName, ChannelProvider>([
      ['email', new EmailChannel(cfg.email)],
      ['webhook', new WebhookChannel(cfg.webhooks)],
    ]);
    if (cfg.whatsapp) this.providers.set('whatsapp', new WhatsAppChannel(cfg.whatsapp));
  }

  get(channel: ChannelName): ChannelProvider | undefined {
    return this.providers.get(channel);
  }

  names(): ChannelName[] {
    return [...this.providers.keys()];
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.providers.values()].map((p) => p.close?.()));
  }
}
