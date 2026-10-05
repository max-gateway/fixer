/**
 * Normaliza um celular brasileiro para E.164 sem "+": 55 + DDD + número.
 * Aceita "(11) 98765-4321", "+55 11 98765-4321", "5511987654321". Retorna null se não for plausível.
 * Só Brasil por enquanto: um número sem DDI com 10/11 dígitos é tratado como nacional.
 */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  // Celular tem 9 dígitos começando em 9; fixo (8 dígitos) não recebe WhatsApp na prática.
  const local = d.slice(4);
  if (local.length === 9 && local[0] !== '9') return null;
  return d;
}
