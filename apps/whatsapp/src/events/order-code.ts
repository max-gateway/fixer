/**
 * Código de vínculo da OS: `OS-XXXX-XXXX`, alfabeto Crockford base32 (sem I, L, O, U).
 * É o que o portal pré-preenche na mensagem do `wa.me`. O cliente pode editar, digitar em minúsculas,
 * trocar hífen por espaço ou confundir O/0 e I/L/1, então a extração é tolerante e devolve o código
 * canônico. Este formato é um contrato com apps/api (`whatsapp-link/link-code.ts`): mudar aqui exige mudar lá.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PATTERN = /(?<![A-Z0-9])OS[\s-]?([A-Z0-9]{4})[\s-]?([A-Z0-9]{4})(?![A-Z0-9])/g;
/** Mensagens longas não são tentativas de vínculo; limita o trabalho feito com texto de terceiros. */
const MAX_SCAN = 500;

const fix = (s: string) => s.replace(/O/g, '0').replace(/[IL]/g, '1');
const valid = (s: string) => [...s].every((c) => ALPHABET.includes(c));

export function extractOrderCode(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const m of text.slice(0, MAX_SCAN).toUpperCase().matchAll(PATTERN)) {
    const a = fix(m[1]!);
    const b = fix(m[2]!);
    if (valid(a) && valid(b)) return `OS-${a}-${b}`;
  }
  return null;
}
