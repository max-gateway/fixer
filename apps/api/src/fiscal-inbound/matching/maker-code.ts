/**
 * Código do fabricante que o fornecedor escreve no começo da descrição ("TDI1089-TERMINAL DIRECAO VW GOL..."). É a chave que o catálogo conhece quando a nota
 * vem "SEM GTIN": o `cProd` é código interno do fornecedor e não serve ao catálogo.
 */

/** Mesma normalização do `partNumberKey` da plataforma: maiúsculas, sem hífen, ponto, barra nem espaço. */
export const partNumberKey = (v: string): string => v.toUpperCase().replace(/[\s.\-/]/g, '');

const CODE = /^[A-Za-z0-9][A-Za-z0-9./]{2,29}$/;

/**
 * Candidatos a código de fabricante, do mais provável ao menos: o trecho antes do primeiro " - " ou "-", esse trecho junto com o seguinte (códigos com hífen,
 * como "AB-123") e a primeira palavra. Só vale o que tem ao menos um dígito (descrição solta como "PARAFUSO" nunca vira código) e de 3 a 30 caracteres.
 */
export function makerCodeCandidates(description: string): string[] {
  const text = description.trim();
  const parts = text.split(/\s*-\s*/).filter(Boolean);
  const raw = [parts[0], parts.length > 2 ? `${parts[0]}-${parts[1]}` : undefined, text.includes('-') ? undefined : text.split(/\s+/)[0]];
  const out: string[] = [];
  for (const c of raw) {
    if (!c || !CODE.test(c.replace(/-/g, '')) || !/\d/.test(c)) continue;
    const key = partNumberKey(c);
    if (!out.some((o) => partNumberKey(o) === key)) out.push(c);
  }
  return out;
}
