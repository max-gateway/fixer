const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/**
 * Chave de comparação de telefones brasileiros: DDD + número, sem DDI. A Meta às vezes entrega o
 * `wa_id` de números antigos sem o nono dígito (551187654321 para (11) 98765-4321), então um
 * número de 10 dígitos cujo local começa em 6-9 ganha o 9. Assim "o mesmo telefone" é o mesmo
 * independente de formatação, DDI ou nono dígito.
 */
export function phoneKey(raw: string | null | undefined): string {
  let d = digits(raw);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2]!)) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d;
}

export const samePhone = (a: string | null | undefined, b: string | null | undefined) => {
  const ka = phoneKey(a);
  return ka !== '' && ka === phoneKey(b);
};

/** Como o telefone é guardado no cadastro: só dígitos nacionais (o formulário do portal valida 10-11). */
export const toNational = phoneKey;

/** Formato do serviço de WhatsApp (E.164 sem "+"). */
export const toE164 = (raw: string) => `55${phoneKey(raw)}`;

export const last4 = (raw: string) => digits(raw).slice(-4);
