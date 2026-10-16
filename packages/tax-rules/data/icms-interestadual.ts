import type { TableMeta } from '../src/types.js';

// Alíquotas interestaduais do ICMS: Resolução do Senado Federal 22/1989 (12% geral; 7% das regiões Sul e Sudeste para
// Norte, Nordeste, Centro-Oeste e Espírito Santo) e Resolução 13/2012 (4% para importados e para o que tem Conteúdo de
// Importação superior a 40%, desde 2013-01-01). Textos da Câmara dos Deputados lidos em 2026-10-13.

export const UF_REGION: Record<string, 'N' | 'NE' | 'CO' | 'SE' | 'S'> = {
  AC: 'N', AM: 'N', AP: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
  AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
  DF: 'CO', GO: 'CO', MS: 'CO', MT: 'CO',
  ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
  PR: 'S', RS: 'S', SC: 'S',
};

export const ICMS_INTERESTADUAL_META: TableMeta = {
  id: 'icms-interestadual',
  version: '2026-10-13.1',
  effectiveFrom: '2013-01-01',
  effectiveTo: null,
  sources: [
    { law: 'Resolução do Senado Federal 22/1989, arts. 1º e 2º', url: 'https://www2.camara.leg.br/legin/fed/ressen/1989/resolucao-22-19-maio-1989-481183-publicacaooriginal-1-pl.html', retrievedAt: '2026-10-13' },
    { law: 'Resolução do Senado Federal 13/2012, arts. 1º e 3º', url: 'https://www2.camara.leg.br/legin/fed/ressen/2012/resolucao-13-25-abril-2012-612768-publicacaooriginal-135841-pl.html', retrievedAt: '2026-10-13' },
  ],
  validatedBy: null,
  caveats: [
    'Textos de publicação original: a Câmara não mostra alterações posteriores. Conferir se houve alteração.',
    'A Resolução 13/2012 exclui bens sem similar nacional (lista Camex) e os produzidos pelo processo produtivo básico; essas exclusões dependem de dado fora do NCM (CST de origem 6, 7 e 4).',
    'O gás natural importado é excluído (art. 2º). Exportação a 13% (Res. 22/89, art. 2º) não é operação de compra de peça e não está modelada.',
    'Operações com consumidor final não contribuinte têm regra própria (EC 87/2015, DIFAL) que não está aqui.',
    'A regra de 7% vale para "Regiões Sul e Sudeste" (PR, RS, SC, ES, MG, RJ, SP) com destino a Norte, Nordeste, Centro-Oeste e ES.',
  ],
};
