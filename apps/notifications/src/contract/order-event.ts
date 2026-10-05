import { z } from 'zod';

/**
 * Cópia LOCAL do contrato v1 publicado pela API (apps/api/src/outbox/order-events.ts).
 * Propositalmente não compartilhada via pacote: o contrato é o JSON no stream, e
 * cada lado evolui no seu ritmo. Campos novos são ignorados (forward-compatible);
 * `version` diferente de 1 é recusado e vai para a DLQ.
 */
const Person = z.object({ id: z.string(), name: z.string(), email: z.string().nullable() });

export const OrderEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1), // tipos desconhecidos são aceitos e apenas não geram notificação
  version: z.literal(1),
  occurredAt: z.string().datetime(),
  tenant: z.string(),
  aggregate: z.object({ type: z.string(), id: z.string() }),
  actor: z.object({
    kind: z.enum(['staff', 'customer', 'system']),
    id: z.string().nullish(),
    name: z.string().nullish(),
  }),
  order: z.object({
    id: z.string(),
    number: z.number().int(),
    status: z.string(),
    portalUrl: z.string(),
    customer: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    }),
    vehicle: z.object({ plate: z.string(), brand: z.string(), model: z.string() }),
    createdBy: Person.nullable(),
    assignedTo: Person.nullable(),
  }),
  data: z.record(z.unknown()).default({}),
});
export type OrderEvent = z.infer<typeof OrderEventSchema>;
