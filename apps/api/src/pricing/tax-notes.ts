import { monofasicoAutopeca, stAutopecaItems } from '@fixer/tax-rules';

// Avisos que cruzam o que o XML do fornecedor diz com as tabelas de regra (docs/specs/tax-rules.md). São informação para a
// pessoa conferir: não mudam o cálculo do imposto, que segue a evidência do XML e a confirmação feita na peça.

export type TaxNoteCode =
  | 'MONOFASICO_XML_FORA_DA_LISTA'
  | 'MONOFASICO_NA_LISTA_SEM_XML'
  | 'MONOFASICO_DEPENDE'
  | 'ST_XML_FORA_DO_ANEXO'
  | 'ST_NO_ANEXO_SEM_XML';

export interface TaxNote {
  code: TaxNoteCode;
  /** Em linguagem de balcão. */
  text: string;
}

export function taxNotes(input: { ncm: string | null; xmlMonofasico: boolean; xmlSt: boolean; asOf: string }): TaxNote[] {
  const notes: TaxNote[] = [];
  const mono = monofasicoAutopeca(input.ncm, input.asOf);

  if (input.xmlMonofasico && mono.status === 'NAO') {
    notes.push({ code: 'MONOFASICO_XML_FORA_DA_LISTA', text: 'O fornecedor tratou o PIS/COFINS como monofásico, mas o NCM não está na lista de autopeças da Lei 10.485. Confirme com o contador antes de zerar PIS e COFINS.' });
  } else if (!input.xmlMonofasico && mono.status === 'SIM') {
    notes.push({ code: 'MONOFASICO_NA_LISTA_SEM_XML', text: 'O NCM está na lista de autopeças monofásicas (Lei 10.485), mas a nota não indica PIS/COFINS monofásico. Se a peça é monofásica, confirme o enquadramento na peça.' });
  } else if (mono.status === 'DEPENDE') {
    notes.push({ code: 'MONOFASICO_DEPENDE', text: `O NCM só é monofásico em certos casos (${mono.entry?.condition ?? 'ver a lei'}). Confirme o enquadramento na peça.` });
  }

  const st = stAutopecaItems(input.ncm);
  if (input.xmlSt && st.length === 0 && (input.ncm ?? '').replace(/\D/g, '').length >= 4) {
    notes.push({ code: 'ST_XML_FORA_DO_ANEXO', text: 'A nota traz ICMS-ST, mas o NCM não consta do Anexo II de autopeças do Convênio ICMS 142/2018. Pode ser outro segmento de ST; vale conferir.' });
  } else if (!input.xmlSt && st.length > 0) {
    notes.push({ code: 'ST_NO_ANEXO_SEM_XML', text: `O NCM consta do Anexo II de autopeças (CEST ${st.map((i) => i.cest).slice(0, 3).join(', ')}), mas a nota não traz ICMS-ST. Em compra interestadual, confira se há ST na UF de destino ou antecipação.` });
  }
  return notes;
}

export interface Enquadramento {
  /** Decidido pela lei e pela nota sem ninguém clicar. */
  auto: boolean;
  /** PIS/COFINS monofásico para quem revende. Só tem valor quando `auto`. */
  monofasico: boolean | null;
  /** A nota do fornecedor trouxe PIS/COFINS normal num NCM que a lei zera para o revendedor: a lei prevalece sobre a nota. */
  lawOverridesNote: boolean;
}

const NO: Enquadramento = { auto: false, monofasico: null, lawOverridesNote: false };

/**
 * Enquadramento da peça que dá para decidir lendo a lei, sem pergunta à pessoa.
 *
 * PIS/COFINS: o revendedor atacadista ou varejista tem as contribuições reduzidas a 0% na venda dos produtos dos Anexos I e II
 * da Lei 10.485 (art. 3º, § 2º) e dos pneus e câmaras de ar (art. 5º, parágrafo único). Isso depende do NCM de quem vende, não
 * do que o fornecedor destacou na nota dele: NCM da lista → monofásico, mesmo que a nota traga PIS/COFINS normal. NCM fora da
 * lista com nota monofásica é conflito (NCM errado no XML?) e fica para a pessoa, assim como NCM que só vale em certos casos
 * (ex-tarifário, destino) ou fora da vigência. A lista acaba em 2027-01-01.
 *
 * ICMS: ST na nota com NCM do Anexo II (ou sem ST e fora do Anexo II) concorda; qualquer divergência é da pessoa.
 *
 * Exige os dados fiscais do item no XML e NCM de 8 dígitos. O benefício não consta do demonstrativo de gastos tributários de 2026
 * (que dispara a redução da LC 224/2025, art. 4º), mas o anexo da LOA final não foi lido: ver os caveats de monofasico-autopecas.
 */
export function resolveEnquadramento(input: { ncm: string | null; xmlMonofasico: boolean; xmlSt: boolean; asOf: string; hasXmlTax: boolean }): Enquadramento {
  if (!input.hasXmlTax) return NO;
  if ((input.ncm ?? '').replace(/D/g, '').length !== 8) return NO;

  const mono = monofasicoAutopeca(input.ncm, input.asOf).status;
  const stInAnnex = stAutopecaItems(input.ncm).length > 0;
  if (input.xmlSt !== stInAnnex) return NO;

  if (mono === 'SIM') return { auto: true, monofasico: true, lawOverridesNote: !input.xmlMonofasico };
  if (mono === 'NAO' && !input.xmlMonofasico) return { auto: true, monofasico: false, lawOverridesNote: false };
  return NO;
}
