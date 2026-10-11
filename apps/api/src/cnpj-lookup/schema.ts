import { z } from 'zod';

// Contrato do microservice apps/cnpj-lookup (sem o `raw`, que não sai do serviço).
const text = z.string().nullish();

export const CnpjLookupResultSchema = z.object({
  cnpj: z.string(),
  razao_social: text,
  nome_fantasia: text,
  situacao: text,
  data_abertura: text,
  natureza_juridica: text,
  porte: text,
  cnae_principal: z.object({ codigo: z.string(), descricao: z.string() }).nullish(),
  endereco: z
    .object({
      logradouro: text,
      numero: text,
      complemento: text,
      bairro: text,
      municipio: text,
      uf: text,
      cep: text,
    })
    .nullish(),
  telefones: z.array(z.string()).default([]),
  emails: z.array(z.string()).default([]),
  inscricoes_estaduais: z
    .array(
      z.object({
        numero: z.string(),
        uf: z.string(),
        habilitada: z.boolean().nullish(),
        situacao: text,
        tipo: text,
      }),
    )
    .default([]),
  atualizado_em: text,
});

export type CnpjLookupResult = z.infer<typeof CnpjLookupResultSchema>;
