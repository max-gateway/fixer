import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`);
const digits = (v: string) => v.replace(/\D/g, '');
/** Campo opcional de formulário: string vazia vira null. */
const optional = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const SYMPTOMS = [
  'NOISE',
  'LEAK',
  'WARNING_LIGHT',
  'VIBRATION',
  'BRAKES',
  'WONT_START',
  'OVERHEATING',
  'SMOKE_SMELL',
] as const;
export const WHEN = ['ALWAYS', 'BRAKING', 'ACCELERATING', 'COLD_START', 'WHEN_HOT', 'SOMETIMES'] as const;

export const ProblemReportSchema = z.object({
  body: text(2000).min(3, 'Descreva o problema com um pouco mais de detalhe'),
  symptoms: z.array(z.enum(SYMPTOMS)).max(SYMPTOMS.length).default([]),
  when: z.enum(WHEN).nullish().transform((v) => v ?? null),
});

export const ChecklistAnswerSchema = z.object({
  status: z.enum(['PENDING', 'OK', 'ISSUE']),
  note: optional(500),
});

/** CPF (11) ou CNPJ (14), só dígitos. Sem dígito verificador, igual ao cadastro da oficina. */
export const DocumentSchema = z
  .string()
  .transform(digits)
  .refine((v) => v.length === 11 || v.length === 14, 'CPF ou CNPJ inválido');

export const CustomerDataSchema = z.object({
  /** Obrigatório só enquanto o cadastro está pendente; depois é ignorado. */
  document: DocumentSchema.nullish().transform((v) => v ?? null),
  name: text(120).min(2, 'Nome obrigatório'),
  phone: optional(20)
    .transform((v) => (v ? digits(v) : null))
    .refine((v) => v === null || (v.length >= 10 && v.length <= 11), 'Telefone inválido'),
  email: optional(160).refine((v) => v === null || z.string().email().safeParse(v).success, 'E-mail inválido'),
  zipCode: optional(9)
    .transform((v) => (v ? digits(v) : null))
    .refine((v) => v === null || v.length === 8, 'CEP inválido'),
  street: optional(160),
  number: optional(20),
  complement: optional(80),
  district: optional(80),
  city: optional(80),
  state: optional(2)
    .transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'UF inválida'),
});

export type ProblemReportInput = z.infer<typeof ProblemReportSchema>;
export type ChecklistAnswerInput = z.infer<typeof ChecklistAnswerSchema>;
export type CustomerDataInput = z.infer<typeof CustomerDataSchema>;
