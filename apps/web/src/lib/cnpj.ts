// CNPJ alfanumérico (NT 2014.002 v1.40, vigente desde 08/07/2026): 12 posições [A-Z0-9] + 2 dígitos
// verificadores. Mesma regra do servidor (apps/api/src/fiscal-inbound/cnpj.ts); a API valida de novo,
// isto só dá retorno imediato no formulário.

export const normalizeCnpj = (input: string) => input.replace(/[.\-/\s]/g, '').toUpperCase();

const value = (ch: string) => ch.charCodeAt(0) - 48;

function checkDigit(chars: string): number {
  let sum = 0;
  for (let i = chars.length - 1, w = 2; i >= 0; i--, w = w === 9 ? 2 : w + 1) sum += value(chars[i]!) * w;
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export function isValidCnpj(cnpj: string): boolean {
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  const d1 = checkDigit(cnpj.slice(0, 12));
  const d2 = checkDigit(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(`${d1}${d2}`);
}

/** `12ABC34501DE35` → `12.ABC.345/01DE-35`, aos poucos, enquanto a pessoa digita. */
export function maskCnpj(raw: string): string {
  const v = normalizeCnpj(raw).slice(0, 14);
  const parts = [v.slice(0, 2), v.slice(2, 5), v.slice(5, 8), v.slice(8, 12), v.slice(12, 14)];
  let out = parts[0]!;
  if (parts[1]) out += `.${parts[1]}`;
  if (parts[2]) out += `.${parts[2]}`;
  if (parts[3]) out += `/${parts[3]}`;
  if (parts[4]) out += `-${parts[4]}`;
  return out;
}

export const UF_CODES: { code: number; sigla: string }[] = [
  [12, 'AC'], [27, 'AL'], [16, 'AP'], [13, 'AM'], [29, 'BA'], [23, 'CE'], [53, 'DF'], [32, 'ES'], [52, 'GO'], [21, 'MA'],
  [51, 'MT'], [50, 'MS'], [31, 'MG'], [15, 'PA'], [25, 'PB'], [41, 'PR'], [26, 'PE'], [22, 'PI'], [33, 'RJ'], [24, 'RN'],
  [43, 'RS'], [11, 'RO'], [14, 'RR'], [42, 'SC'], [35, 'SP'], [28, 'SE'], [17, 'TO'],
]
  .map(([code, sigla]) => ({ code: code as number, sigla: sigla as string }))
  .sort((a, b) => a.sigla.localeCompare(b.sigla));
