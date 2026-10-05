import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CONFIG, type AppConfig } from '../config/config.js';
import { Metrics } from '../health/metrics.service.js';
import { verifySignature } from './signature.js';
import { WebhooksService } from './webhooks.service.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Único endpoint exposto à internet (a Meta chama daqui). A autenticidade vem da assinatura HMAC do
 * corpo bruto, não de IP nem de chave. Responde 200 rápido; o trabalho é uma transação curta.
 */
@Controller('webhooks/meta')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly metrics: Metrics,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Handshake de cadastro do webhook no painel da Meta. */
  @Get()
  @Header('content-type', 'text/plain')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const expected = this.cfg.meta.verifyToken;
    const ok =
      mode === 'subscribe' &&
      !!expected &&
      !!token &&
      timingSafeEqual(digest(expected), digest(token));
    if (!ok) throw new ForbiddenException('verify_token inválido');
    return challenge;
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    if (!verifySignature(req.rawBody, signature, this.cfg.meta.appSecret)) {
      this.metrics.webhooks.inc({ kind: 'any', result: 'invalid_signature' });
      throw new UnauthorizedException('Assinatura inválida');
    }
    await this.webhooks.handle(body);
    return { received: true };
  }
}
