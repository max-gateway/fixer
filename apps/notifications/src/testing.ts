import type { OrderEvent } from './contract/order-event.js';

/** Fábrica de eventos para testes. */
export function makeEvent(over: Partial<OrderEvent> = {}): OrderEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'order.status_changed',
    version: 1,
    occurredAt: '2026-10-04T12:00:00.000Z',
    tenant: 'oficina-silva',
    aggregate: { type: 'service_order', id: 'o1' },
    actor: { kind: 'staff', id: 'u1', name: 'Ana' },
    order: {
      id: 'o1',
      number: 7,
      status: 'IN_PROGRESS',
      portalUrl: 'https://app.test/o/tok',
      customer: { id: 'c1', name: 'João', email: 'Joao@X.com ', phone: null },
      vehicle: { plate: 'ABC1D23', brand: 'VW', model: 'Gol' },
      createdBy: { id: 'u1', name: 'Ana', email: 'ana@oficina.com' },
      assignedTo: null,
    },
    data: { from: 'APPROVED', to: 'IN_PROGRESS' },
    ...over,
  };
}
