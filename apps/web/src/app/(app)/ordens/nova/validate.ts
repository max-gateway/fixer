export type FormValues = {
  plate: string;
  brand: string;
  model: string;
  year: string;
  color: string;
};

export type FieldName = 'plate' | 'brand' | 'model' | 'year';
export type Errors = Partial<Record<FieldName, string>>;

/** Mesmas regras da API (CreateServiceOrderSchema), para o erro aparecer no campo antes do envio. */
export function validate(v: FormValues, now = new Date()): Errors {
  const e: Errors = {};

  if (!/^[A-Z0-9]{7}$/.test(v.plate)) e.plate = 'Informe a placa completa (7 caracteres)';
  if (!v.brand.trim()) e.brand = 'Marca obrigatória';
  if (!v.model.trim()) e.model = 'Modelo obrigatório';

  if (v.year) {
    const year = Number(v.year);
    if (!Number.isInteger(year) || year < 1900 || year > now.getFullYear() + 1) e.year = 'Ano inválido';
  }
  return e;
}

export const hasErrors = (e: Errors) => Object.keys(e).length > 0;
