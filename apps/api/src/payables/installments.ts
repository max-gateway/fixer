import type { ParsedNfe } from '../fiscal-inbound/parser/nfe.parser.js';

export interface PayableDraft {
  source: 'XML_INSTALLMENT' | 'XML_TOTAL';
  installment: number;
  installmentCount: number;
  documentNumber: string | null;
  dueDate: Date;
  amount: string;
}

const MONEY = /^\d+(\.\d{1,2})?$/;

/** Data civil AAAA-MM-DD como meia-noite UTC: a coluna é DATE, sem fuso. */
const civil = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Transforma a cobrança do XML em parcelas a pagar. As duplicatas (`cobr/dup`) mandam; sem elas, a nota que declara
 * pagamento (`pag/detPag`) vira uma parcela única vencendo na emissão. Parcela sem vencimento válido ou com valor
 * zerado/malformado é descartada: um dado ruim nunca pode derrubar o lote (o ingest roda na transação da SEFAZ).
 */
export function draftPayables(nfe: ParsedNfe): PayableDraft[] {
  const fallbackDue = (nfe.issuedAt ?? new Date()).toISOString().slice(0, 10);
  const docNumber = nfe.number !== null ? String(nfe.number) : null;

  const valid = nfe.installments.filter((d) => MONEY.test(d.amount) && Number(d.amount) > 0);
  if (valid.length > 0) {
    return valid.map((d, i) => ({
      source: 'XML_INSTALLMENT' as const,
      installment: i + 1,
      installmentCount: valid.length,
      documentNumber: d.number ?? docNumber,
      // Duplicata sem dVenc (opcional no leiaute): vence na emissão, o cenário mais conservador.
      dueDate: civil(d.dueDate ?? fallbackDue),
      amount: normalize(d.amount),
    }));
  }
  if (nfe.declaredPayment) {
    return [{ source: 'XML_TOTAL', installment: 1, installmentCount: 1, documentNumber: docNumber, dueDate: civil(fallbackDue), amount: nfe.declaredPayment }];
  }
  return [];
}

const normalize = (v: string) => {
  const [i, f = ''] = v.split('.');
  return `${i}.${f.padEnd(2, '0')}`;
};
