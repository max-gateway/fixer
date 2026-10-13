import { UF_CODES } from '@/lib/cnpj';

/** Dados fiscais que a consulta de CNPJ consegue dar; `null` = a Receita/CNPJá não informou (nunca um palpite). */
export type CnpjFiscalHints = { municipalityIbge: string | null; simples: boolean | null };

export type CompanyLookup = {
  company: { cnpj: string; legalName?: string; ufCode?: number };
  hints: CnpjFiscalHints;
  /** false = a consulta falhou: só o CNPJ (do certificado) é conhecido. */
  found: boolean;
};

type Raw = {
  razao_social?: string | null;
  endereco?: { uf?: string | null } | null;
  fiscal?: Partial<CnpjFiscalHints> | null;
};

/** CNPJ → dados da empresa + dicas fiscais. A consulta é conveniência: se falhar, devolve só o CNPJ. */
export async function lookupCompany(cnpj: string): Promise<CompanyLookup> {
  const res = await fetch(`/api/customers/cnpj-lookup/${encodeURIComponent(cnpj)}`).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as Raw | null) : null;
  const ufCode = UF_CODES.find((u) => u.sigla === data?.endereco?.uf?.toUpperCase())?.code;
  const legalName = data?.razao_social?.trim().slice(0, 200);
  return {
    company: { cnpj, ...(legalName ? { legalName } : {}), ...(ufCode ? { ufCode } : {}) },
    hints: { municipalityIbge: data?.fiscal?.municipalityIbge ?? null, simples: data?.fiscal?.simples ?? null },
    found: Boolean(data),
  };
}

/**
 * Corpo do PUT /fiscal/settings a partir das dicas. `reset` (empresa nova) zera o que é específico do município
 * (ISS e código de tributação), que não pode sobrar de outra empresa; sem `reset` só preenche o que a consulta trouxe.
 */
export function settingsFromHints(hints: CnpjFiscalHints, reset: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (reset) {
    body.issRate = null;
    body.municipalServiceCode = null;
    body.municipalityIbge = hints.municipalityIbge;
    body.taxRegime = hints.simples ? 'SIMPLES' : null;
    return body;
  }
  if (hints.municipalityIbge) body.municipalityIbge = hints.municipalityIbge;
  if (hints.simples) body.taxRegime = 'SIMPLES';
  return body;
}
