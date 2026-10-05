import { z } from 'zod';

/**
 * Espelha app/models/schemas.py::PlateLookupResult do microservice
 * apps/plate-lookup (Python). Mantenha os dois em sincronia manualmente —
 * não há geração de schema compartilhado entre os dois serviços.
 */

const BasicoDadosSchema = z.object({
  marcamodelo: z.string().nullable().optional(),
  rouboFurto: z.string().nullable().optional(),
  mensagemRetorno: z.string().nullable().optional(),
  final_chassi: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  cor: z.string().nullable().optional(),
  ano: z.number().int().nullable().optional(),
  anoModelo: z.number().int().nullable().optional(),
  municipio: z.string().nullable().optional(),
  uf: z.string().nullable().optional(),
  origem: z.string().nullable().optional(),
  placa_modelo_novo: z.string().nullable().optional(),
  placa_modelo_antigo: z.string().nullable().optional(),
  especie: z.string().nullable().optional(),
  tipo: z.string().nullable().optional(),
  combustivel: z.string().nullable().optional(),
  data: z.string().nullable().optional(),
  atualizado: z.boolean().nullable().optional(),
  logo: z.string().nullable().optional(),
});

const BasicoBlockSchema = z.object({
  error: z.boolean().default(false),
  message: z.string().nullable().optional(),
  dados: BasicoDadosSchema.nullable().optional(),
  execucao: z.string().nullable().optional(),
});

const ChassiBlockSchema = z.object({
  error: z.boolean().default(false),
  message: z.string().nullable().optional(),
  dados: z.object({ chassi: z.string().nullable().optional() }).nullable().optional(),
  execucao: z.string().nullable().optional(),
});

const RenavamBlockSchema = z.object({
  error: z.boolean().default(false),
  message: z.string().nullable().optional(),
  dados: z.object({ renavam: z.string().nullable().optional() }).nullable().optional(),
  execucao: z.string().nullable().optional(),
});

const RouboFurtoBlockSchema = z.object({
  error: z.boolean().default(false),
  message: z.string().nullable().optional(),
  dados: z
    .object({
      rouboFurto: z.string().nullable().optional(),
      data: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  execucao: z.string().nullable().optional(),
});

const FipeHistoricoItemSchema = z.object({
  valor: z.string().nullable().optional(),
  mes_referencia: z.string().nullable().optional(),
});

const FipeDadosItemSchema = z.object({
  valor: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  ano: z.string().nullable().optional(),
  combustivel: z.string().nullable().optional(),
  codigo_fipe: z.string().nullable().optional(),
  mes_referencia: z.string().nullable().optional(),
  score: z.number().int().nullable().optional(),
  historico: z.array(FipeHistoricoItemSchema).default([]),
});

const FipeBlockSchema = z.object({
  error: z.boolean().default(false),
  message: z.string().nullable().optional(),
  dados: z.array(FipeDadosItemSchema).default([]),
  execucao: z.string().nullable().optional(),
});

export const PlateLookupResultSchema = z.object({
  error: z.boolean().default(false),
  message: z.string().nullable().optional(),
  basico: BasicoBlockSchema.nullable().optional(),
  chassi: ChassiBlockSchema.nullable().optional(),
  renavam: RenavamBlockSchema.nullable().optional(),
  rouboFurto: RouboFurtoBlockSchema.nullable().optional(),
  fipe: FipeBlockSchema.nullable().optional(),
});

export type PlateLookupResult = z.infer<typeof PlateLookupResultSchema>;
