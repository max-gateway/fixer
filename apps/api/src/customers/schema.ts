import { z } from 'zod';

// CPF (11 dígitos) ou CNPJ (14 posições; alfanumérico desde 07/2026) — guardamos sem máscara,
// é a chave única do cliente. Não validamos dígito verificador aqui; só o formato.
const document = z
  .string()
  .transform((v) => v.replace(/[.\-/\s]/g, '').toUpperCase())
  .refine((v) => /^\d{11}$/.test(v) || /^[A-Z0-9]{12}\d{2}$/.test(v), 'Documento deve ser CPF (11 dígitos) ou CNPJ (14 caracteres)');

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
  // Preenchidos pela consulta de CNPJ no formulário (apps/cnpj-lookup).
  zipCode: optionalText.transform((v) => (v ? v.replace(/\D/g, '') || null : v)),
  street: optionalText,
  number: optionalText,
  complement: optionalText,
  district: optionalText,
  city: optionalText,
  state: optionalText,
  tradeName: optionalText,
  stateRegistration: optionalText,
  stateRegistrationStatus: optionalText,
  registryCheckedAt: z.coerce.date().nullable().optional(),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
