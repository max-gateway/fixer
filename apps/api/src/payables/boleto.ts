import { addDaysIso, civil, todayIso } from './dates.js';

/**
 * Linha digitável / código de barras de boleto. Valida os dígitos verificadores (um dígito errado é quase sempre
 * erro de digitação) e extrai o que dá para preencher sozinho: valor e vencimento.
 *
 *  - Boleto bancário (47 dígitos, ou 44 do código de barras): módulo 10 nos três campos, módulo 11 no dígito geral;
 *    traz fator de vencimento e valor.
 *  - Arrecadação/convênio (48 dígitos, começa com 8): quatro blocos de 11 + DV (módulo 10 ou 11 conforme o 3º dígito);
 *    traz o valor quando for "valor efetivo". Não traz vencimento.
 */
export type BoletoResult =
  | { ok: true; kind: 'bank' | 'utility'; digits: string; amount: string | null; dueDate: string | null; bankCode: string | null }
  | { ok: false; reason: 'LENGTH' | 'CHECK_DIGIT' };

/** DV módulo 10 (pesos 2,1,2,1… da direita para a esquerda; soma dos algarismos dos produtos). */
export function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const p = Number(digits[i]) * weight;
    sum += p > 9 ? p - 9 : p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function weightedMod11(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum % 11;
}

/** DV geral do boleto bancário: resto 0, 10 ou 11 vira 1. */
export function mod11Bank(digits: string): number {
  const dv = 11 - weightedMod11(digits);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** DV módulo 11 dos blocos de convênio: resto 0 ou 1 vira 0. */
export function mod11Utility(digits: string): number {
  const r = weightedMod11(digits);
  return r <= 1 ? 0 : 11 - r;
}

const cents = (digits: string): string | null => {
  const n = BigInt(digits);
  if (n === 0n) return null;
  return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
};

/**
 * O fator de vencimento conta dias desde 07/10/1997 e volta de 9999 para 1000 em 22/02/2025. Cada fator tem então dois
 * candidatos, 9000 dias separados; vale o mais próximo de hoje (boletos vencem em poucos anos, nunca em décadas).
 */
export function dueFromFactor(factor: number, now: Date = new Date()): string | null {
  if (factor < 1000 || factor > 9999) return null;
  const today = civil(todayIso(now)).getTime();
  const first = addDaysIso('1997-10-07', factor);
  const second = addDaysIso('1997-10-07', factor + 9000);
  const best = Math.abs(civil(first).getTime() - today) <= Math.abs(civil(second).getTime() - today) ? first : second;
  return best;
}

export function parseBoleto(input: string, now: Date = new Date()): BoletoResult {
  const d = input.replace(/\D/g, '');
  if (d.length === 47) return parseBankLine(d, now);
  if (d.length === 44 && d[0] !== '8') return parseBankBarcode(d, now);
  if (d.length === 48 && d[0] === '8') return parseUtility(d);
  return { ok: false, reason: 'LENGTH' };
}

function bankInfo(barcode: string, now: Date) {
  const factor = Number(barcode.slice(5, 9));
  return {
    ok: true as const,
    kind: 'bank' as const,
    amount: cents(barcode.slice(9, 19)),
    dueDate: factor === 0 ? null : dueFromFactor(factor, now),
    bankCode: barcode.slice(0, 3),
  };
}

function parseBankBarcode(d: string, now: Date): BoletoResult {
  if (mod11Bank(d.slice(0, 4) + d.slice(5)) !== Number(d[4])) return { ok: false, reason: 'CHECK_DIGIT' };
  return { ...bankInfo(d, now), digits: d };
}

function parseBankLine(d: string, now: Date): BoletoResult {
  const fields = [d.slice(0, 9), d.slice(10, 20), d.slice(21, 31)];
  const dvs = [d[9]!, d[20]!, d[31]!];
  if (fields.some((f, i) => mod10(f) !== Number(dvs[i]))) return { ok: false, reason: 'CHECK_DIGIT' };
  // Remonta o código de barras: banco/moeda, DV geral, fator+valor, e o campo livre espalhado nos três campos.
  const barcode = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  if (mod11Bank(barcode.slice(0, 4) + barcode.slice(5)) !== Number(barcode[4])) return { ok: false, reason: 'CHECK_DIGIT' };
  return { ...bankInfo(barcode, now), digits: d };
}

function parseUtility(d: string): BoletoResult {
  const blocks = [d.slice(0, 12), d.slice(12, 24), d.slice(24, 36), d.slice(36, 48)];
  // 6 e 7: módulo 10; 8 e 9: módulo 11 (3º dígito do código de barras).
  const useMod10 = d[2] === '6' || d[2] === '7';
  const dvOf = useMod10 ? mod10 : mod11Utility;
  if (blocks.some((b) => dvOf(b.slice(0, 11)) !== Number(b[11]))) return { ok: false, reason: 'CHECK_DIGIT' };
  const barcode = blocks.map((b) => b.slice(0, 11)).join('');
  // 6 e 8 trazem valor efetivo; 7 e 9 só referência (valor livre).
  const hasAmount = d[2] === '6' || d[2] === '8';
  return { ok: true, kind: 'utility', digits: d, amount: hasAmount ? cents(barcode.slice(4, 15)) : null, dueDate: null, bankCode: null };
}

