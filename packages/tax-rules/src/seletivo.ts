import { SELETIVO, SELETIVO_META, type SeletivoCategory, type SeletivoEntry } from '../data/imposto-seletivo.js';

// Imposto Seletivo (LC 214/2025, Livro II): diz se a NCM consta do Anexo XVII e em qual categoria. O valor depende de alíquotas de lei
// ordinária que o pacote não tem, então a resposta traz `rateStatus: 'ALIQUOTA_NAO_FIXADA'` e nunca um número.

export type SeletivoStatus =
  | 'INCIDE' // a NCM consta do Anexo XVII sem ressalva que a NCM não resolva
  | 'DEPENDE' // consta, mas com ressalva textual (caminhão, uso militar...) que quem chama precisa confirmar
  | 'NAO_INCIDE' // a NCM não consta do Anexo XVII
  | 'ANTES_DA_VIGENCIA'
  | 'NCM_INVALIDO';

export interface SeletivoResult {
  status: SeletivoStatus;
  category: SeletivoCategory | null;
  /** Ressalva do anexo a confirmar (status DEPENDE). */
  condition: string | null;
  /** Ressalva que não depende da NCM (uso militar ou de segurança pública): aviso para o enquadramento. */
  carveOut: string | null;
  /** O imposto combina alíquota ad valorem e específica (art. 422, § 1º). */
  specificRate: boolean;
  rateStatus: 'ALIQUOTA_NAO_FIXADA' | null;
}

const none = (status: SeletivoStatus): SeletivoResult => ({ status, category: null, condition: null, carveOut: null, specificRate: false, rateStatus: null });

/** Maior prefixo que casa vence (posição inteira cede a um código mais específico com exceção). */
export function impostoSeletivo(ncmInput: string, asOf: string): SeletivoResult {
  const ncm = ncmInput.replace(/\D/g, '');
  if (!/^\d{8}$/.test(ncm)) return none('NCM_INVALIDO');
  if (asOf < SELETIVO_META.effectiveFrom) return none('ANTES_DA_VIGENCIA');
  const hits: SeletivoEntry[] = SELETIVO.filter((e) => ncm.startsWith(e.ncmPrefix));
  const hit = hits.filter((e) => !e.exceptNcm?.some((x) => ncm.startsWith(x))).sort((a, b) => b.ncmPrefix.length - a.ncmPrefix.length)[0];
  if (!hit) return none('NAO_INCIDE');
  return {
    status: hit.condition ? 'DEPENDE' : 'INCIDE',
    category: hit.category,
    condition: hit.condition ?? null,
    carveOut: hit.carveOut ?? null,
    specificRate: hit.specificRate ?? false,
    rateStatus: 'ALIQUOTA_NAO_FIXADA',
  };
}
