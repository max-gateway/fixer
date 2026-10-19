import { CNAE_LC116, type CnaeServiceEntry } from '../data/cnae-lc116.js';
import { PE_INTERNAL_RATE_PCT } from '../data/pe-icms.js';

/** Aceita a CNAE com ou sem máscara ("45.20-0-01", "4520-0/01", 4520001). */
export function normalizeCnae(cnae: string | number): string {
  return String(cnae).replace(/\D/g, '');
}

/** Item da LC 116 para a CNAE principal da oficina; null = CNAE fora da tabela (não é palpite: o chamador decide o fallback). */
export function serviceItemForCnae(cnae: string | number | null | undefined): CnaeServiceEntry | null {
  if (cnae == null) return null;
  const code = normalizeCnae(cnae);
  return CNAE_LC116.find((e) => e.cnae === code) ?? null;
}

/** Alíquota interna modal do ICMS das UFs que o pacote já cobre; null = UF sem tabela (nunca uma média nacional). */
const INTERNAL_MODAL_PCT: Record<string, string> = { PE: PE_INTERNAL_RATE_PCT };

export function internalModalRatePct(uf: string | null | undefined): string | null {
  return uf ? (INTERNAL_MODAL_PCT[uf.toUpperCase()] ?? null) : null;
}
