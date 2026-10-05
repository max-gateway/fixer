import { z } from 'zod';

// CPF (11) ou CNPJ (14) — guardamos só dígitos, é a chave única do cliente.
// Não validamos dígito verificador aqui; só o formato.
const document = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 11 || v.length === 14, 'Documento deve ser CPF (11) ou CNPJ (14 dígitos)');

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const CreateCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório'),
  document,
  // Só dígitos, como o portal e a abertura de OS por telefone, para o cadastro ser achado por ele.
  phone: optionalText.transform((v) => (v ? v.replace(/\D/g, '') || null : v)),
  email: z.string().trim().email('E-mail inválido').or(z.literal('')).transform((v) => v || null).nullable().optional(),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
