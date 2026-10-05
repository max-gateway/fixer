import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiKeyGuard } from '../api/api-key.guard.js';
import { MessagesService } from './messages.service.js';
import { IDEMPOTENCY_KEY, OptSchema, SendMessageSchema } from './schema.js';

function parse<T>(schema: ZodType<T, any, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new BadRequestException(
    r.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; '),
  );
}

/** API interna (serviço-a-serviço). Não é exposta ao navegador nem à internet. */
@UseGuards(ApiKeyGuard)
@Controller('v1')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /** 202: aceita e enfileirada. Reenviar com a mesma Idempotency-Key devolve a mesma mensagem. */
  @Post('messages')
  @HttpCode(202)
  send(
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      throw new BadRequestException(
        'Header Idempotency-Key obrigatório (8-128 caracteres: letras, números, . _ : -)',
      );
    }
    return this.messages.enqueue(key, parse(SendMessageSchema, body));
  }

  @Get('messages')
  list(@Query('orderId') orderId: string) {
    return this.messages.listByOrder(orderId);
  }

  @Get('messages/:id')
  get(@Param('id') id: string) {
    return this.messages.get(id);
  }

  @Post('contacts/:phone/opt-out')
  @HttpCode(200)
  optOut(@Param('phone') phone: string, @Body() body: unknown) {
    return this.messages.setOpt(
      phone,
      'OPTED_OUT',
      parse(OptSchema, body ?? {}).reason,
    );
  }

  @Post('contacts/:phone/opt-in')
  @HttpCode(200)
  optIn(@Param('phone') phone: string, @Body() body: unknown) {
    return this.messages.setOpt(
      phone,
      'OPTED_IN',
      parse(OptSchema, body ?? {}).reason,
    );
  }
}
