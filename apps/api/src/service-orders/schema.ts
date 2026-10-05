import { z } from 'zod';

const STATUSES = [
  'QUOTE',
  'APPROVED',
  'IN_PROGRESS',
  'AWAITING_PART',
  'COMPLETED',
  'DELIVERED',
  'CANCELLED',
] as const;

export const ServiceOrderStatusSchema = z.enum(STATUSES);

const plate = z
  .string()
  .transform((v) => v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
  .refine((v) => /^[A-Z0-9]{7}$/.test(v), 'Placa inválida');

/** Celular/WhatsApp com DDD, só dígitos (aceita +55 na frente). */
const mobilePhone = z
  .string()
  .transform((v) => v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''))
  .refine(
    (v) => v.length === 10 || v.length === 11,
    'Informe o celular com DDD',
  );

export const CreateServiceOrderSchema = z.object({
    // Nem o telefone é obrigatório: sem ele a ordem nasce com cadastro pendente e o número é capturado
    // quando o cliente toca em "Falar com a oficina" no portal (vínculo por WhatsApp). O cliente completa
    // o resto (CPF/CNPJ, endereço) pelo portal.
    customerPhone: mobilePhone.optional(),
    customerId: z.string().min(1).optional(),
    vehicle: z.object({
      plate,
      brand: z.string().trim().min(1, 'Marca obrigatória'),
      model: z.string().trim().min(1, 'Modelo obrigatório'),
      year: z.number().int().nullable().optional(),
      color: z.string().trim().nullable().optional(),
    }),
    description: z.string().trim().nullable().optional(),
    mileageAtEntry: z.number().int().nonnegative().nullable().optional(),
    partLines: z
      .array(
        z.object({
          partId: z.string().min(1),
          quantity: z.number().positive('Quantidade deve ser positiva'),
        }),
      )
      .default([]),
    serviceLines: z
      .array(
        z.object({
          serviceId: z.string().min(1),
          price: z.number().nonnegative().optional(),
        }),
      )
      .default([]),
  });

export const TransitionSchema = z.object({
  status: ServiceOrderStatusSchema,
  note: z.string().trim().nullable().optional(),
});

export const MessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Escreva uma mensagem')
    .max(2000, 'Máximo de 2000 caracteres'),
});

export const ChecklistItemSchema = z.object({
  section: z.string().trim().min(1).max(60).default('Outros'),
  label: z.string().trim().min(3, 'Descreva o item').max(200),
});

export type CreateServiceOrderInput = z.infer<typeof CreateServiceOrderSchema>;
export type TransitionInput = z.infer<typeof TransitionSchema>;
export type MessageInput = z.infer<typeof MessageSchema>;
export type ChecklistItemInput = z.infer<typeof ChecklistItemSchema>;
