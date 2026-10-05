import { z } from 'zod';
import { TEMPLATES, isTemplateName } from '../templates/templates.js';

const reference = z
  .record(z.union([z.string().max(200), z.number()]))
  .refine(
    (r) => Object.keys(r).length <= 10,
    'No máximo 10 chaves em reference',
  )
  .default({});

export const SendMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('template'),
    to: z.string().min(8).max(32),
    template: z.string().refine(isTemplateName, (v) => ({
      message: `Template desconhecido: ${v}. Disponíveis: ${Object.keys(TEMPLATES).join(', ')}`,
    })),
    variables: z.array(z.string()).max(10),
    reference,
  }),
  z.object({
    type: z.literal('text'),
    to: z.string().min(8).max(32),
    text: z.string().trim().min(1).max(4096),
    reference,
  }),
]);
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const OptSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
