import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { emitOrderEvent } from '../outbox/order-events.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { appendEvent } from '../service-orders/events.js';
import type { OrderCodeReceived } from './inbound-event.js';
import { decideLink } from './link.policy.js';
import { last4, toE164, toNational } from './phone.js';

export type LinkOutcome =
  | 'duplicate_event'
  | 'unknown_code'
  | 'linked'
  | 'already_linked'
  | 'conflict'
  | 'closed';

/**
 * Aplica `whatsapp.order_code_received` à ordem: vincula o WhatsApp de quem escreveu.
 *
 * Garantias:
 *  - IDEMPOTENTE: o id do evento entra em `ProcessedInboundEvent` (PK) na MESMA transação do efeito.
 *    Reentrega (at-least-once) cai no conflito e vira no-op; falha no meio desfaz tudo, inclusive a marca.
 *  - SEM CORRIDA: a linha da ordem é travada (FOR UPDATE) antes de decidir; dois números disputando o
 *    mesmo código são serializados e só o primeiro vincula.
 *  - ATÔMICO com os eventos de saída: a mudança e o `order.whatsapp_linked` (outbox) saem juntos.
 *  - SILENCIOSO para desconhecidos: código inexistente, ordem encerrada e repetição não geram resposta
 *    (não vira oráculo para adivinhar códigos nem canal de spam).
 */
@Injectable()
export class WhatsappLinkService {
  private readonly logger = new Logger(WhatsappLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    /** A limpeza do inbox atravessa organizações: usa o cliente de sistema. */
    @Optional() @Inject(SystemPrismaService) private readonly system: SystemPrismaService | null = null,
  ) {}

  handle(event: OrderCodeReceived): Promise<LinkOutcome> {
    const { from, code } = event.data;

    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.processedInboundEvent.createMany({
        data: [{ id: event.id, type: event.type }],
        skipDuplicates: true,
      });
      if (fresh.count === 0) return 'duplicate_event';

      await tx.$queryRaw`SELECT 1 FROM "ServiceOrder" WHERE "linkCode" = ${code} FOR UPDATE`;
      const order = await tx.serviceOrder.findUnique({
        where: { linkCode: code },
        select: {
          id: true,
          status: true,
          whatsappLinkedPhone: true,
          customerId: true,
          customer: { select: { name: true, phone: true } },
        },
      });
      if (!order) return 'unknown_code';

      const decision = decideLink(
        { status: order.status, whatsappLinkedPhone: order.whatsappLinkedPhone, customerPhone: order.customer.phone },
        from,
      );

      switch (decision.kind) {
        case 'closed':
        case 'already_linked':
          return decision.kind;

        case 'link': {
          await tx.serviceOrder.update({
            where: { id: order.id },
            data: { whatsappLinkedAt: new Date(), whatsappLinkedPhone: toE164(from) },
          });
          if (decision.fillCustomerPhone) {
            await tx.customer.update({ where: { id: order.customerId }, data: { phone: toNational(from) } });
          }
          await appendEvent(tx, order.id, {
            type: 'WHATSAPP_LINK',
            author: 'SYSTEM',
            body: 'WhatsApp conectado: as atualizações da ordem também chegam por aqui.',
            data: { result: 'linked', phoneLast4: last4(from) },
          });
          // Depois do update: o snapshot do evento já carrega o telefone do cliente.
          await emitOrderEvent(tx, order.id, 'order.whatsapp_linked', { kind: 'customer', id: order.customerId, name: order.customer.name }, {
            result: 'linked',
            phone: toE164(from),
          });
          return 'linked';
        }

        case 'conflict': {
          // Um registro por número tentando: reenvio insistente não polui a linha do tempo.
          const phoneLast4 = last4(from);
          const seen = await tx.serviceOrderEvent.findFirst({
            where: {
              serviceOrderId: order.id,
              type: 'WHATSAPP_LINK',
              AND: [{ data: { path: ['result'], equals: 'conflict' } }, { data: { path: ['phoneLast4'], equals: phoneLast4 } }],
            },
            select: { id: true },
          });
          if (!seen) {
            await appendEvent(tx, order.id, {
              type: 'WHATSAPP_LINK',
              author: 'SYSTEM',
              body: `Um WhatsApp diferente do cadastrado (final ${phoneLast4}) tentou se conectar a esta ordem. Confirme o telefone do cliente.`,
              data: { result: 'conflict', reason: decision.reason, phoneLast4 },
            });
            await emitOrderEvent(tx, order.id, 'order.whatsapp_link_conflict', { kind: 'system' }, {
              reason: decision.reason,
              phoneLast4,
            });
            this.logger.warn(`Conflito de vínculo na ordem ${order.id} (${decision.reason}, final ${phoneLast4})`);
          }
          return 'conflict';
        }
      }
    });
  }

  /** O inbox só precisa cobrir a janela de reentrega do stream; o resto é lixo. */
  async purgeProcessed(olderThanDays = 14): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const { count } = await (this.system ?? this.prisma).processedInboundEvent.deleteMany({ where: { processedAt: { lt: cutoff } } });
    return count;
  }
}
