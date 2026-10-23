import type { TableMeta } from '../src/types.js';

// ICMS interno de Pernambuco (Lei 15.730/2016, arts. 15 e 18-A, texto consolidado da SEFAZ-PE lido em 2026-10-22).
//
// A "alíquota modal" não é geral: o art. 15 dá 25% (Anexo 2), 12% (trigo, farinha, pão e transporte aéreo), 7% (gesso, bunker) e o
// art. 18-A dá 22,5% a 29% aos produtos do FECEP (Anexo 1) e aos veículos (Anexo 1-A). Só as "demais hipóteses" pagam a modal
// (art. 15, VII): 18% até 2023-12-31 e 20,5% a partir de 2024-01-01 (Lei 18.305/2023). O FECEP (adicional de 2 pontos, Lei 12.523/2003)
// já está dentro das alíquotas do Anexo 1; mercadoria fora dele não paga adicional.
//
// O pacote só responde a alíquota interna dos segmentos que cura (autopeças do Anexo II do Convênio 142 e pneus); o resto é
// FORA_DA_COBERTURA, porque o art. 15 depende de ~100 posições dos Anexos 1, 1-A, 1-B e 2 e de produtos sem NCM no texto (trigo, pão).

export interface PeInternalRatePeriod {
  from: string;
  to: string | null;
  ratePct: string;
  source: string;
}

export const PE_ICMS_INTERNAL_MODAL: PeInternalRatePeriod[] = [
  { from: '2019-04-01', to: '2023-12-31', ratePct: '18.00', source: 'Lei 15.730/2016, art. 15, VII, a (redação da Lei 16.489/2018)' },
  { from: '2024-01-01', to: null, ratePct: '20.50', source: 'Lei 15.730/2016, art. 15, VII (redação da Lei 18.305/2023)' },
];

/**
 * NCM de autopeças ou pneus que também aparecem em anexo de alíquota majorada/FECEP da lei de PE, já avaliados à mão. Um NCM novo
 * nessa interseção derruba a verificação até alguém avaliar.
 */
export const PE_ICMS_ANNEX_OVERLAPS_REVIEWED: Record<string, string> = {
  '39173229': 'Anexo 1 (FECEP, item 4.8) é "canudo plástico descartável"; o CEST 01.002.00 do Convênio 142 é tubo plástico de veículo. O NCM é o mesmo, o produto não: quem classifica decide.',
};

export const PE_ICMS_INTERNO_META: TableMeta = {
  id: 'pe-icms-interno',
  version: '2026-10-22.1',
  effectiveFrom: '2019-04-01',
  effectiveTo: null,
  sources: [{ law: 'Lei Estadual 15.730/2016 (PE), arts. 15 e 18-A e Anexos 1, 1-A, 1-B e 2, texto consolidado', url: 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/legislacao/Leis_Tributarias/2016/Lei15730_2016.htm', retrievedAt: '2026-10-22' }],
  validatedBy: null,
  caveats: [
    'Só autopeças (Anexo II do Convênio 142/2018) e pneus: qualquer outra mercadoria devolve FORA_DA_COBERTURA, porque o art. 15 tem alíquotas de 7% a 29% por produto.',
    'Antes de 2019-04-01 a tabela não responde (redação anterior da lei não conferida).',
    'Redução de base, isenção, diferimento, crédito presumido e benefícios do RICMS-PE para a operação não estão modelados.',
    'O FECEP está embutido nas alíquotas do Anexo 1 (art. 18-A): autopeça e pneu não pagam adicional. A única NCM que cruza os anexos é 3917.32.29 (ver PE_ICMS_ANNEX_OVERLAPS_REVIEWED).',
  ],
};
