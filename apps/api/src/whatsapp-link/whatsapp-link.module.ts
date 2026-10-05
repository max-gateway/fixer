import { Module } from '@nestjs/common';
import { WhatsappInboundConsumer } from './inbound-consumer.service.js';
import { WhatsappLinkService } from './link.service.js';

/** Vínculo OS <-> WhatsApp do cliente: consome eventos do apps/whatsapp, sem ler nada do banco dele. */
@Module({ providers: [WhatsappLinkService, WhatsappInboundConsumer] })
export class WhatsappLinkModule {}
