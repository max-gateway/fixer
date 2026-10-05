import type { EventAuthor, EventType, Prisma } from '@fixer/db';

/** Campos de um evento expostos nas respostas (staff e portal). */
export const EVENT_SELECT = {
  id: true,
  type: true,
  author: true,
  authorName: true,
  body: true,
  data: true,
  createdAt: true,
} satisfies Prisma.ServiceOrderEventSelect;

export interface NewEvent {
  type: EventType;
  author: EventAuthor;
  authorName?: string | null;
  authorUserId?: string | null;
  body?: string | null;
  data?: Prisma.InputJsonValue;
}

/** Eventos são append-only: nunca editados nem removidos. */
export function appendEvent(tx: Prisma.TransactionClient, serviceOrderId: string, event: NewEvent) {
  return tx.serviceOrderEvent.create({
    data: {
      serviceOrderId,
      type: event.type,
      author: event.author,
      authorName: event.authorName ?? null,
      authorUserId: event.authorUserId ?? null,
      body: event.body ?? null,
      data: event.data,
    },
    select: EVENT_SELECT,
  });
}
