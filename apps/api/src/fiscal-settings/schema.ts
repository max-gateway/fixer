import { z } from 'zod';

const digitsOnly = (v: string) => v.replace(/\D/g, '');
/** Aceita máscara ("8708.93.00") e devolve só os dígitos; vazio vira null. */
const digits = z
  .string()
  .transform((v) => digitsOnly(v) || null)
  .nullable();

export const UpdateSettingsSchema = z.object({
  municipalityIbge: z
    .string()
    .regex(/^\d{7}$/, 'Código IBGE do município deve ter 7 dígitos')
    .nullable()
    .optional(),
  taxRegime: z.enum(['SIMPLES', 'PRESUMIDO', 'REAL']).nullable().optional(),
  issRate: z.number().gt(0, 'Alíquota deve ser maior que 0').max(5, 'Alíquota de ISS no máximo 5%').nullable().optional(),
  municipalServiceCode: z.string().trim().min(1).max(20).nullable().optional(),
  hourlyRate: z.number().nonnegative().nullable().optional(),
});

/**
 * Edição dos dados fiscais de uma peça. Aceita dados incompletos (dá para salvar aos poucos);
 * a completude só é cobrada na confirmação (`verifyPart`) e na emissão.
 */
export const PartFiscalSchema = z
  .object({
    ncm: digits.optional(),
    cest: digits.optional(),
    originCode: z.number().int().min(0).max(8).nullable().optional(),
    unit: z.string().trim().toUpperCase().max(6).nullable().optional(),
    defaultCfop: digits.optional(),
    csosn: digits.optional(),
    cst: digits.optional(),
  })
  .strict();

export const VerifySchema = z.object({ verified: z.boolean() });

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;
export type PartFiscalInput = z.infer<typeof PartFiscalSchema>;
