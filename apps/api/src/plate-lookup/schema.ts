import { z } from 'zod';

/**
 * Visão tipada e tolerante da resposta da Puxa Placa. O que é persistido em
 * PlateLookup.rawResponse é o JSON cru do provedor (o microservice
 * apps/plate-lookup o repassa sem filtrar); este schema só serve para LER
 * campos de forma tipada. Campos não declarados aqui passam intactos
 * (`.passthrough()`), então adicionar um campo novo é só declará-lo — não
 * exige reconsultar a placa.
 */

// O provedor devolve números como string ("2023"); null/vazio vira null.
const looseNumber = z.preprocess(
  (v) => (v === '' || v === null ? null : typeof v === 'string' ? Number(v) : v),
  z.number().nullable().optional(),
);
const looseInt = z.preprocess(
  (v) => (v === '' || v === null ? null : typeof v === 'string' ? Number(v) : v),
  z.number().int().nullable().optional(),
);

const BasicoDadosSchema = z.object({
  marcamodelo: z.string().nullable().optional(),
  rouboFurto: z.string().nullable().optional(),
  mensagemRetorno: z.string().nullable().optional(),
  final_chassi: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  cor: z.string().nullable().optional(),
  ano: looseInt,
  anoModelo: looseInt,
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
  // Motorização e dados técnicos
  motor: z.string().nullable().optional(),
  cilindradas: looseNumber,
  potencia: looseNumber,
  cmt: looseNumber,
  cmc: looseNumber,
  pbt: looseNumber,
  lotacao: looseInt,
  qtdEixos: looseInt,
  tipoVeiculo: z.string().nullable().optional(),
  tipoCarroceria: z.string().nullable().optional(),
  procedencia: z.string().nullable().optional(),
  segmento: z.string().nullable().optional(),
  sub_segmento: z.string().nullable().optional(),
  modelo_lista: z.array(z.string()).nullable().optional(),
}).passthrough();

const BasicoBlockSchema = z.object({
  error: z.boolean().default(false),
  message: z.string().nullable().optional(),
  dados: BasicoDadosSchema.nullable().optional(),
  execucao: z.string().nullable().optional(),
}).passthrough();

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
}).passthrough();

export type PlateLookupResult = z.infer<typeof PlateLookupResultSchema>;
