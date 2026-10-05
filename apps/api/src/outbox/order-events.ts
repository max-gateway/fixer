import { randomUUID } from 'node:crypto';
import type { Prisma } from '@fixer/db';

/**
 * Contrato público (v1) dos eventos de ordem de serviço. É o ÚNICO ponto de
 * acoplamento com consumidores como `apps/notifications`: eles mantêm a sua
 * própria cópia deste formato e nunca leem o banco da API. Mudança
 * incompatível => novo `version`, nunca editar campos do v1.
 */
export const ORDER_EVENT_TYPES = [
  'order.created',
  'order.status_changed',
  'order.message_posted',
  'order.problem_reported',
  'order.checklist_item_added',
  'order.checklist_item_answered',
  'order.customer_data_updated',
  'order.whatsapp_linked',
  'order.whatsapp_link_conflict',
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export interface EventActor {
  kind: 'staff' | 'customer' | 'system';
  id?: string | null;
  name?: string | null;
}

/** Tudo que um consumidor precisa para agir sem voltar a consultar a API. */
export function buildOrderSnapshot(
  order: {
    id: string;
    number: number;
    status: string;
    portalToken: string;
    customer: { id: string; name: string; email: string | null; phone: string | null };
    vehicle: { plate: string; brand: string; model: string };
    createdBy: { id: string; name: string; email: string } | null;
    assignedTo: { id: string; name: string; email: string } | null;
  },
  portalBaseUrl = process.env.PORTAL_BASE_URL ?? 'http://localhost:3001',
) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    portalUrl: `${portalBaseUrl.replace(/\/$/, '')}/o/${order.portalToken}`,
    customer: order.customer,
    vehicle: order.vehicle,
    createdBy: order.createdBy,
    assignedTo: order.assignedTo,
  };
}

export const ORDER_SNAPSHOT_SELECT = {
  id: true,
  number: true,
  status: true,
  portalToken: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  vehicle: { select: { plate: true, brand: true, model: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ServiceOrderSelect;

/**
 * Grava o evento no outbox usando a transação recebida: a mudança da ordem e o
 * evento são atômicos. A publicação no stream fica a cargo do OutboxRelay.
 */
export async function emitOrderEvent(
  tx: Prisma.TransactionClient,
  orderId: string,
  type: OrderEventType,
  actor: EventActor,
  data: Prisma.InputJsonObject = {},
) {
  const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, select: ORDER_SNAPSHOT_SELECT });
  const id = randomUUID();
  const occurredAt = new Date();
  const envelope = {
    id,
    type,
    version: 1,
    occurredAt: occurredAt.toISOString(),
    tenant: process.env.TENANT_SLUG ?? 'local',
    aggregate: { type: 'service_order', id: orderId },
    actor,
    order: buildOrderSnapshot(order),
    data,
  };
  await tx.outboxEvent.create({
    data: {
      id,
      type,
      aggregateType: 'service_order',
      aggregateId: orderId,
      payload: envelope as unknown as Prisma.InputJsonObject,
      createdAt: occurredAt,
    },
  });
}
