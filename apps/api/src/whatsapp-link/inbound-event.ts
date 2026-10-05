import { z } from 'zod';
import { LINK_CODE_PATTERN } from './link-code.js';

/**
 * Cópia LOCAL do contrato v1 publicado por apps/whatsapp (`events/event-outbox.ts`). Propositalmente
 * não compartilhada por pacote: o contrato é o JSON no stream e cada lado evolui no seu ritmo.
 * Campos novos são ignorados (forward-compatible); `version` diferente de 1 vai para a DLQ.
 */
export const EnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  version: z.number().int(),
});

export const ORDER_CODE_RECEIVED = 'whatsapp.order_code_received';

export const OrderCodeReceivedSchema = z.object({
  id: z.string().uuid(),
  type: z.literal(ORDER_CODE_RECEIVED),
  version: z.literal(1),
  occurredAt: z.string().datetime(),
  tenant: z.string().min(1),
  source: z.literal('whatsapp'),
  data: z.object({
    wamid: z.string().min(1),
    from: z.string().regex(/^\d{10,15}$/),
    code: z.string().regex(LINK_CODE_PATTERN),
    sentAt: z.string().datetime(),
  }),
});
export type OrderCodeReceived = z.infer<typeof OrderCodeReceivedSchema>;
