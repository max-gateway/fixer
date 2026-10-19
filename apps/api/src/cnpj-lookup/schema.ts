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

/**
 * Dados fiscais que o contrato do serviço ainda não expõe, mas que vêm no `raw` (resposta do CNPJá):
 * código IBGE do município e opção pelo Simples/MEI. Sem o dado, `null` (nunca um palpite).
 */
export interface CnpjFiscalHints {
  /** Código IBGE do município (7 dígitos). */
  municipalityIbge: string | null;
  /** true = optante pelo Simples Nacional (inclui MEI); false = não optante; null = a consulta não informou. */
  simples: boolean | null;
  /** CNAEs secundárias (7 dígitos); a oficina que tem comércio de peças como principal costuma ter o serviço aqui. */
  secondaryCnaes: string[];
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);

export function fiscalHintsFromRaw(raw: unknown): CnpjFiscalHints {
  const root = obj(raw);
  const company = obj(root?.company);
  const ibge = String(obj(root?.address)?.municipality ?? '').replace(/\D/g, '');
  const optant = (node: unknown) => {
    const v = obj(node)?.optant;
    return typeof v === 'boolean' ? v : null;
  };
  const simples = optant(company?.simples);
  const mei = optant(company?.simei);
  const side = Array.isArray(root?.sideActivities) ? root.sideActivities : [];
  const secondaryCnaes = side.map((a) => String(obj(a)?.id ?? '').replace(/\D/g, '')).filter((id) => /^\d{7}$/.test(id));
  return {
    secondaryCnaes,
    municipalityIbge: /^\d{7}$/.test(ibge) ? ibge : null,
    simples: simples === true || mei === true ? true : simples === false || mei === false ? false : null,
  };
}
