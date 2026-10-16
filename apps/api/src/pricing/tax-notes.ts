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
