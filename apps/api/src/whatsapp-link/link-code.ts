import { randomInt } from 'node:crypto';

/**
 * Código de vínculo da OS: `OS-XXXX-XXXX`, alfabeto Crockford base32 (sem I, L, O, U, para não
 * confundir quando o cliente digita). 32^8 ≈ 1,1 trilhão de códigos, e quem erra demais é
 * freado por rate limit no serviço de WhatsApp. O formato é contrato com apps/whatsapp
 * (`events/order-code.ts`) e com a migration que preencheu as ordens antigas.
 *
 * O código NÃO é credencial de acesso: só serve para vincular um WhatsApp à ordem. O acesso ao
 * portal continua sendo o `portalToken`.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LINK_CODE_PATTERN = /^OS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function generateLinkCode(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)]!;
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `OS-${group()}-${group()}`;
}

/**
 * Link `wa.me` que abre o WhatsApp do cliente já com a mensagem pronta (basta enviar).
 * `businessPhone` é o número da oficina; sem ele não há como gerar o link (retorna null).
 */
export function whatsappDeepLink(businessPhone: string | undefined, code: string): string | null {
  const phone = (businessPhone ?? '').replace(/\D/g, '');
  if (phone.length < 10) return null;
  const text = `Olá! Quero acompanhar minha OS pelo WhatsApp. Código: ${code}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
