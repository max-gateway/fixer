/** Celular brasileiro: (11) 98765-4321 (aceita fixo de 10 dígitos). */
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  const split = d.length === 11 ? 7 : 6;
  return d.length <= split ? `(${d.slice(0, 2)}) ${d.slice(2)}` : `(${d.slice(0, 2)}) ${d.slice(2, split)}-${d.slice(split)}`;
}

/** Só letras e números, maiúsculas, no máximo 7 (placa antiga ou Mercosul). */
export const normalizePlate = (v: string): string => v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 7);

/** Placa para exibição: ABC-1D23 -> ABC1D23 fica como veio; antiga ganha o hífen (ABC1234 -> ABC-1234). */
export const formatPlate = (v: string): string => (/^[A-Z]{3}\d{4}$/.test(v) ? `${v.slice(0, 3)}-${v.slice(3)}` : v);
