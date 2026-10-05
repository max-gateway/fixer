import { BadRequestException, Body, Controller, Get, HttpCode, MessageEvent, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { interval, map, merge, type Observable } from 'rxjs';
import { z } from 'zod';
import { InboxBus } from '../inbox/inbox.bus.js';
import { InboxService } from '../inbox/inbox.service.js';
import { AuthGuard, CurrentMe, type Me } from './auth.guard.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
  unread: z.enum(['true', 'false']).default('false'),
});
const ReadBody = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })]);

const parse = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T => {
  const r = schema.safeParse(data);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Requisição inválida');
  return r.data;
};

@Controller('v1/inbox')
@UseGuards(AuthGuard)
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly bus: InboxBus,
  ) {}

  @Get()
  list(@CurrentMe() me: Me, @Query() query: unknown) {
    const q = parse(ListQuery, query);
    return this.inbox.list(me.email, { limit: q.limit, cursor: q.cursor, unreadOnly: q.unread === 'true' });
  }

  @Post('read')
  @HttpCode(200)
  async read(@CurrentMe() me: Me, @Body() body: unknown) {
    const updated = await this.inbox.markRead(me.email, parse(ReadBody, body));
    return { updated, unreadCount: await this.inbox.unreadCount(me.email) };
  }

  /**
   * SSE: itens novos em tempo real. O heartbeat mantém proxies/LB de pé e deixa o cliente detectar
   * conexão morta. Ao reconectar, o cliente refaz a listagem (o stream não tem replay).
   */
  @Sse('stream')
  stream(@CurrentMe() me: Me): Observable<MessageEvent> {
    const items = this.bus.subscribe(me.email).pipe(map((item): MessageEvent => ({ type: 'notification', data: item })));
    const heartbeat = interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));
    return merge(items, heartbeat);
  }
}
