// Interpretação do Fixer sobre os códigos do Convênio s/nº de 1970 (data/cst-csosn.ts): o texto legal não diz quais CST dão
// crédito ao comprador; estas listas são regra do Fixer.

// CST do ICMS que dão ao comprador do regime normal direito ao crédito do ICMS próprio destacado.
const CST_WITH_CREDIT = new Set(['00', '10', '20', '70', '90']);
// CSOSN do emitente Simples que permitem ao comprador do regime normal aproveitar `vCredICMSSN` (o 900, "Outros", só quando
// a nota traz o valor).
const CSOSN_WITH_CREDIT = new Set(['101', '201', '900']);

/** O ICMS próprio destacado na nota gera crédito para o comprador do regime normal? */
export function icmsCreditAllowed(kind: 'CST' | 'CSOSN' | null, code: string | null): boolean {
  if (!kind || !code) return false;
  return kind === 'CST' ? CST_WITH_CREDIT.has(code) : CSOSN_WITH_CREDIT.has(code);
}

/** CST 60 / CSOSN 500: o ICMS-ST já foi retido numa etapa anterior da cadeia. */
export function isStPaidBefore(kind: 'CST' | 'CSOSN' | null, code: string | null): boolean {
  return (kind === 'CST' && code === '60') || (kind === 'CSOSN' && code === '500');
}
