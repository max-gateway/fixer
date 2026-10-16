import type { TableMeta } from '../src/types.js';

// Códigos da NF-e para o ICMS: Convênio s/nº, de 15/12/1970, Anexo II... (Anexo "Código de Situação Tributária", Tabelas A e B),
// Anexo III (CRT) e Anexo III-A (CSOSN), com as alterações até o Ajuste SINIEF 39/23 e 20/24 (Tabela B em vigor desde
// 2023-12-01; os itens 12, 13, 52, 72 e 74 foram acrescidos e revogados antes de produzir efeitos). Transcrito do texto
// do Confaz lido em 2026-10-13.

export interface CodeEntry {
  code: string;
  title: string;
}

/** Tabela A: origem da mercadoria (1º dígito do CST). */
export const ORIGEM: CodeEntry[] = [
  { code: '0', title: 'Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8' },
  { code: '1', title: 'Estrangeira - Importação direta, exceto a indicada no código 6' },
  { code: '2', title: 'Estrangeira - Adquirida no mercado interno, exceto a indicada no código 7' },
  { code: '3', title: 'Nacional, mercadoria ou bem com Conteúdo de Importação superior a 40% e inferior ou igual a 70%' },
  { code: '4', title: 'Nacional, cuja produção tenha sido feita em conformidade com os processos produtivos básicos (Decreto-Lei 288/67 e Leis 8.248/91, 8.387/91, 10.176/01 e 11.484/07)' },
  { code: '5', title: 'Nacional, mercadoria ou bem com Conteúdo de Importação inferior ou igual a 40%' },
  { code: '6', title: 'Estrangeira - Importação direta, sem similar nacional, constante em lista de Resolução CAMEX e gás natural' },
  { code: '7', title: 'Estrangeira - Adquirida no mercado interno, sem similar nacional, constante em lista de Resolução CAMEX e gás natural' },
  { code: '8', title: 'Nacional, mercadoria ou bem com Conteúdo de Importação superior a 70%' },
];

/** Tabela B: tributação pelo ICMS (2º e 3º dígitos do CST). */
export const CST_ICMS: CodeEntry[] = [
  { code: '00', title: 'Tributada integralmente' },
  { code: '02', title: 'Tributação monofásica própria sobre combustíveis' },
  { code: '10', title: 'Tributada com ICMS devido por substituição tributária, relativo às operações e prestações subsequentes' },
  { code: '15', title: 'Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis' },
  { code: '20', title: 'Tributada com redução de base de cálculo' },
  { code: '30', title: 'Isenta ou não tributada com ICMS devido por substituição tributária' },
  { code: '40', title: 'Isenta' },
  { code: '41', title: 'Não tributada' },
  { code: '50', title: 'Suspensão' },
  { code: '51', title: 'Diferimento' },
  { code: '53', title: 'Tributação monofásica sobre combustíveis com recolhimento diferido' },
  { code: '60', title: 'ICMS cobrado anteriormente por substituição tributária ou por antecipação com encerramento de tributação' },
  { code: '61', title: 'Tributação monofásica sobre combustíveis cobrada anteriormente' },
  { code: '70', title: 'Tributada com redução de base de cálculo e com ICMS devido por substituição tributária, relativo às operações e prestações subsequentes' },
  { code: '90', title: 'Outras' },
];

/** Anexo III: Código de Regime Tributário. */
export const CRT: CodeEntry[] = [
  { code: '1', title: 'Simples Nacional' },
  { code: '2', title: 'Simples Nacional - excesso de sublimite da receita bruta' },
  { code: '3', title: 'Regime Normal' },
  { code: '4', title: 'Simples Nacional - Microempreendedor Individual - MEI' },
];

/** Anexo III-A: CSOSN, usado quando o CRT é 1 ou 4. */
export const CSOSN: CodeEntry[] = [
  { code: '101', title: 'Tributada pelo Simples Nacional com permissão de crédito' },
  { code: '102', title: 'Tributada pelo Simples Nacional sem permissão de crédito' },
  { code: '103', title: 'Isenção do ICMS no Simples Nacional para faixa de receita bruta' },
  { code: '201', title: 'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária' },
  { code: '202', title: 'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária' },
  { code: '203', title: 'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária' },
  { code: '300', title: 'Imune' },
  { code: '400', title: 'Não tributada pelo Simples Nacional' },
  { code: '500', title: 'ICMS cobrado anteriormente por substituição tributária (substituído) ou por antecipação' },
  { code: '900', title: 'Outros' },
];

export const CST_CSOSN_META: TableMeta = {
  id: 'cst-csosn',
  version: '2026-10-13.1',
  effectiveFrom: '2023-12-01',
  effectiveTo: null,
  sources: [{ law: 'Convênio s/nº, de 15/12/1970 (Anexos de CST, CRT e CSOSN), com os Ajustes SINIEF 39/23 e 20/24', url: 'https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cvsn_70', retrievedAt: '2026-10-13' }],
  validatedBy: null,
  caveats: [
    'Os códigos de crédito (quais CST/CSOSN dão direito a crédito ao comprador do regime normal) NÃO estão no texto do convênio: o texto só diz que o CSOSN 101 e o 201 "permitem a indicação do crédito". A regra de crédito do Fixer (cst-credit) é interpretação sobre estes códigos, não texto legal.',
    'Optante do Simples com CRT 2 (excesso de sublimite) usa o CST, não o CSOSN (nota explicativa 4 da Tabela B).',
  ],
};
