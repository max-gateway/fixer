/**
 * CSV para o contador: separador `;` e vírgula decimal (o que o Excel em português espera), BOM UTF-8 para os acentos
 * e proteção contra injeção de fórmula (célula de texto iniciada por = + - @ vira texto literal).
 */
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const text = FORMULA.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Valor decimal ("1234.50") em formato brasileiro, sem separador de milhar ("1234,50"). */
export const csvMoney = (v: string | null | undefined): string => (v == null ? '' : String(v).replace('.', ','));

/** AAAA-MM-DD → DD/MM/AAAA. */
export const csvDate = (iso: string | null | undefined): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export function toCsv(header: string[], rows: (string | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map((c) => csvCell(c)).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
