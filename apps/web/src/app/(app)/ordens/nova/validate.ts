export type FormValues = {
  phone: string;
  plate: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  mileage: string;
  description: string;
};

export type PartLine = { partId: string; quantity: string };

export type FieldName = 'phone' | 'plate' | 'brand' | 'model' | 'year' | 'mileage' | 'parts';
export type Errors = Partial<Record<FieldName, string>>;

/** Mesmas regras da API (CreateServiceOrderSchema), para o erro aparecer no campo antes do envio. */
export function validate(v: FormValues, parts: PartLine[], now = new Date()): Errors {
  const e: Errors = {};

  // O celular é opcional: sem ele, o número é capturado quando o cliente toca em "Falar com a oficina".
  const phone = v.phone.replace(/\D/g, '');
  if (phone && phone.length !== 10 && phone.length !== 11) e.phone = 'Informe o celular com DDD, ex.: (11) 98765-4321';

  if (!/^[A-Z0-9]{7}$/.test(v.plate)) e.plate = 'Informe a placa completa (7 caracteres)';
  if (!v.brand.trim()) e.brand = 'Marca obrigatória';
  if (!v.model.trim()) e.model = 'Modelo obrigatório';

  if (v.year) {
    const year = Number(v.year);
    if (!Number.isInteger(year) || year < 1900 || year > now.getFullYear() + 1) e.year = 'Ano inválido';
  }
  if (v.mileage) {
    const km = Number(v.mileage);
    if (!Number.isInteger(km) || km < 0) e.mileage = 'Use um número inteiro, 0 ou mais';
  }

  if (parts.some((l) => l.partId && !(Number(l.quantity) > 0))) e.parts = 'Quantidade deve ser maior que zero';
  return e;
}

export const hasErrors = (e: Errors) => Object.keys(e).length > 0;
