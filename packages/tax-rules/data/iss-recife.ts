import type { TableMeta } from '../src/types.js';

// ISS do Recife (IBGE 2611606): alíquota por subitem da lista da LC 116. Código Tributário do Município, Lei 15.563/1991, art. 116, na
// redação da Lei 16.933/2003: "a) 2% para os serviços de análises clínicas, ultra-sonografia, radiologia, patologia, ressonância
// magnética e tomografia, parte dos que constam no subitem 4.02 [...]; b) 5% para os demais serviços". O Termo de Orientação do ISS
// da Secretaria de Finanças do Recife lista também 4% para alguns serviços de saúde (4.02, 4.03, 4.04, 4.06 e 4.11).
//
// ESTADO DA CONFERÊNCIA: lido em 2026-10-22 no LegisWeb (texto da Lei 16.933/2003); os sites da Prefeitura recusaram conexão e o texto
// consolidado vigente do art. 116 NÃO foi lido. Por isso a tabela só responde 5% fora do item 4 (saúde), onde o pacote não sabe a
// alíquota. Sem carimbo automático em `verify:sources`.

export const RECIFE_IBGE = '2611606';

export interface IssRecifeRule {
  /** Itens (grupo) da lista a que a regra se aplica. */
  groups: string[];
  /** null = o pacote não sabe a alíquota (SEM_REGRA). */
  ratePct: string | null;
  note: string;
}

export const ISS_RECIFE_RULES: IssRecifeRule[] = [
  { groups: ['4'], ratePct: null, note: 'Saúde: o CTM e o Termo de Orientação têm alíquotas próprias (2% e 4% em subitens do item 4); o pacote não as modela.' },
];

/** Alíquota dos "demais serviços" (CTM, art. 116, b). */
export const ISS_RECIFE_DEFAULT_PCT = '5.00';

export const ISS_RECIFE_META: TableMeta = {
  id: 'iss-recife',
  version: '2026-10-22.1',
  effectiveFrom: '2004-01-01',
  effectiveTo: '2032-12-31',
  sources: [
    { law: 'Lei Municipal 15.563/1991 (CTM do Recife), art. 116, redação da Lei 16.933/2003 (lido no LegisWeb)', url: 'https://www.legisweb.com.br/legislacao/?id=177683', retrievedAt: '2026-10-22' },
    { law: 'Termo de Orientação do ISS, Secretaria de Finanças do Recife', url: 'https://recifeemdia.recife.pe.gov.br/sites/default/files/TERMO_ORIENTACAO_ISS.pdf', retrievedAt: '2026-10-22' },
  ],
  validatedBy: null,
  caveats: [
    'O texto consolidado vigente do art. 116 não foi lido (sites da Prefeitura inacessíveis em 2026-10-22): a redação usada é a da Lei 16.933/2003. Alterações posteriores do CTM não estão conferidas; o contador de Recife deve validar.',
    'Item 4 (saúde) tem alíquotas de 2% e 4%: fora do pacote (SEM_REGRA).',
    'A vigência de 2004-01-01 supõe a Lei 16.933/2003 em vigor desde o exercício seguinte; a LC 116 limita a alíquota entre 2% e 5% (ver iss-lc116).',
    'Em 2029–2032 o ISS cai 10% a 40% da alíquota vigente em 31/12/2028 (LC 116, art. 8º-B): a função devolve o fator, supondo que Recife mantenha a alíquota até 2028.',
    'Retenção na fonte pelo tomador e regimes especiais (MEI, Simples com ISS fixo, sociedade de profissionais) não estão modelados.',
  ],
};
