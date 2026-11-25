// CNPJ alfanumérico (NT 2014.002 v1.40, vigente desde 08/07/2026): 12 posições [A-Z0-9] + 2 dígitos
// verificadores numéricos. Nunca tratar CNPJ ou chave de acesso como número (parseInt/\d).

const CNPJ_RE = /^[A-Z0-9]{12}[0-9]{2}$/;
const ACCESS_KEY_RE = /^[A-Z0-9]{43}[0-9]$/;

/** Cada caractere vale `código ASCII − 48`: dígitos continuam 0–9, letras passam a valer 17–42. */
const value = (ch: string): number => ch.charCodeAt(0) - 48;

/** Remove máscara (`.`, `/`, `-`, espaços) e põe em maiúsculas. Não valida. */
export function normalizeCnpj(input: string): string {
  return input.replace(/[.\-/\s]/g, '').toUpperCase();
}

function cnpjCheckDigit(chars: string): number {
  // Pesos 2..9 cíclicos, da direita para a esquerda.
  let sum = 0;
  for (let i = chars.length - 1, w = 2; i >= 0; i--, w = w === 9 ? 2 : w + 1) sum += value(chars[i]!) * w;
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Valida formato e dígitos verificadores. Aceita só CNPJ já normalizado. */
export function isValidCnpj(cnpj: string): boolean {
  if (!CNPJ_RE.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false; // todos iguais (inclusive zeros)
  const d1 = cnpjCheckDigit(cnpj.slice(0, 12));
  const d2 = cnpjCheckDigit(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(`${d1}${d2}`);
}

/** CNPJ-base: as 8 primeiras posições. A SEFAZ autentica a empresa por ele (NT 2014.002 §3, rejeição 593). */
export function cnpjBase(cnpj: string): string {
  return cnpj.slice(0, 8);
}

/** Dígito verificador da chave de acesso (módulo 11, pesos 2..9) sobre as 43 primeiras posições. */
export function accessKeyCheckDigit(first43: string): number {
  const r = (() => {
    let sum = 0;
    for (let i = first43.length - 1, w = 2; i >= 0; i--, w = w === 9 ? 2 : w + 1) sum += value(first43[i]!) * w;
    return sum % 11;
  })();
  return r < 2 ? 0 : 11 - r;
}

/**
 * Chave de acesso de 44 posições. Para chaves só numéricas é o cálculo oficial; para a parte do CNPJ
 * alfanumérica aplica-se a mesma regra `ASCII − 48` do CNPJ (a conferir na NT do CNPJ alfanumérico,
 * docs/specs/nfe-import.md §14.3).
 */
export function isValidAccessKey(key: string): boolean {
  if (!ACCESS_KEY_RE.test(key)) return false;
  return accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}
