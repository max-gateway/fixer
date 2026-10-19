import type { TableMeta } from '../src/types.js';

// ICMS de Pernambuco na ENTRADA de mercadoria vinda de outra UF (docs/specs/tax-rules.md §8; platform tax-engine.md §12.5).
// Duas regras, que não se somam: a mercadoria sujeita à ST (autopeças) segue a ST; as demais seguem a antecipação geral
// (informativo da SEFAZ-PE, item 2.2.2: "Estão sujeitas à substituição tributária, logo, não se sujeitam à antecipação").

/** Alíquota interna modal de PE (Lei 15.730/2016, art. 15; "20,5% para os demais casos" no RICMS-PE). */
export const PE_INTERNAL_RATE_PCT = '20.5';

// ---------------------------------------------------------------------------------------------------------------------
// ST de autopeças (RICMS-PE, Anexo 37, arts. 99 a 101, incluídos pelo Decreto 57.000/2024, efeitos desde 2024-08-01).

export interface PeStOriginPeriod {
  from: string;
  to: string | null;
  /** UFs cujo remetente RETÉM a ST na venda para PE (signatárias, com PE, dos Protocolos ICMS 97/2010 e 129/2010). */
  retainingUfs: string[];
  basis: string;
}

const PROT_97_BASE = ['AC', 'AL', 'AP', 'BA', 'MA', 'MT', 'PA', 'PB', 'PI', 'PR', 'RJ', 'SE', 'TO'];

export const PE_ST_AUTOPECAS_ORIGINS: PeStOriginPeriod[] = [
  {
    from: '2024-08-01',
    to: '2024-10-31',
    retainingUfs: [...PROT_97_BASE, 'RS', 'SP'],
    basis: 'Prot. ICMS 97/2010 (RS até 31.10.2024, Prot. 33/24) e Prot. ICMS 129/2010 (PE–SP)',
  },
  {
    from: '2024-11-01',
    to: '2026-09-30',
    retainingUfs: [...PROT_97_BASE, 'SP'],
    basis: 'Prot. ICMS 97/2010 (RS excluído pelo Prot. 33/24) e Prot. ICMS 129/2010 (PE–SP)',
  },
  {
    from: '2026-10-01',
    to: null,
    retainingUfs: [...PROT_97_BASE],
    basis: 'Prot. ICMS 97/2010; o Prot. ICMS 129/2010 (PE–SP) foi revogado pelo Prot. ICMS 96/26',
  },
];

/** MVA-ST original (Anexo 37, art. 100, I): 36,56% para fidelidade de compra (Lei 6.729/79) ou contrato de fidelidade; 71,78% nos demais casos. */
export const PE_ST_AUTOPECAS_MVA = { fidelity: '36.56', general: '71.78' } as const;

export const PE_ST_AUTOPECAS_META: TableMeta = {
  id: 'pe-st-autopecas',
  version: '2026-10-19.1',
  effectiveFrom: '2024-08-01',
  effectiveTo: null,
  sources: [
    { law: 'Decreto PE 57.000/2024 (inclui os arts. 99 a 101 no Anexo 37 do RICMS-PE, Dec. 44.650/2017)', url: 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/Legislacao/Decretos/2024/Dec57000_2024.htm', retrievedAt: '2026-10-19' },
    { law: 'Protocolo ICMS 97/2010 (texto consolidado: signatários, MVA e fórmula da MVA ajustada)', url: 'https://www.confaz.fazenda.gov.br/legislacao/protocolos/2010/pt097_10', retrievedAt: '2026-10-19' },
    { law: 'Protocolo ICMS 129/2010 (PE–SP), revogado a partir de 2026-10-01 pelo Prot. ICMS 96/26', url: 'https://www.confaz.fazenda.gov.br/legislacao/protocolos/2010/pt129_10', retrievedAt: '2026-10-19' },
  ],
  validatedBy: null,
  caveats: [
    'Mercadorias: as do Anexo II do Convênio ICMS 142/2018 (tabela st-autopecas-anexo-ii), de uso especificamente automotivo (Resolução de Consulta DLO-PE 38/2024). Item enquadrado só pelo NCM, sem CEST, é estimativa.',
    'A MVA de 36,56% (fidelidade) depende de contrato que não aparece no XML: o cálculo usa 71,78%.',
    'O cálculo do adquirente supõe revenda a varejo (oficina). Atacadista do regime normal pode apurar pelo art. 40 do Anexo 3 e art. 101 do Anexo 37 (custo médio), que não está modelado.',
    'Uso, consumo ou ativo (art. 100, § 1º) tem outra base: o item fora de revenda não recebe ST na entrada.',
    'Despacho Confaz 447/10 ("quanto à aplicação no Estado de PE") não lido: não está no texto consolidado.',
    'Datas de saída de GO, SC e ES do Prot. 97/2010 são anteriores a 2024-08-01 e não importam aqui; RN saiu em 2020-11-01.',
    'Remetente do Simples: a dedução usa a alíquota interestadual nominal sobre a base da operação própria quando a nota não destaca ICMS. Conferir com o contador.',
  ],
};

// ---------------------------------------------------------------------------------------------------------------------
// Antecipação na entrada para o Simples Nacional, mercadoria SEM ST (RICMS-PE arts. 338 a 340 e 363-A; Conv. ICMS 190/2017).

export type PeSimplesSize = 'ME' | 'DEMAIS';

/** Percentual do imposto antecipado por alíquota interna e alíquota interestadual, para contribuinte REGULAR (art. 393-A). */
export const PE_ANTECIPACAO_SIMPLES: Record<PeSimplesSize, Record<string, Record<'4' | '7' | '12', string>>> = {
  // Item 2.3.7.2.2: inscrito como ME (inclusive MEI), fora do Agreste com CNAE do Anexo 19.
  ME: {
    '18': { '4': '4.27', '7': '4.41', '12': '4.66' },
    '20.5': { '4': '4.86', '7': '5.02', '12': '5.31' },
    '25': { '4': '3.91', '7': '4.03', '12': '4.26' },
    '27': { '4': '3.80', '7': '3.92', '12': '4.15' },
  },
  // Item 2.3.7.2.3: demais hipóteses (EPP).
  DEMAIS: {
    '18': { '4': '11.96', '7': '9.70', '12': '5.59' },
    '20.5': { '4': '13.62', '7': '11.05', '12': '6.37' },
    '25': { '4': '16.41', '7': '14.52', '12': '11.08' },
    '27': { '4': '17.49', '7': '15.70', '12': '12.44' },
  },
};

/** Fim do benefício da base reduzida (Conv. ICMS 190/2017); a partir de 2029 o comércio perde 20% ao ano. */
export const PE_ANTECIPACAO_SIMPLES_UNTIL = '2032-12-31';

/** Teto da receita bruta da microempresa (LC 123/2006, art. 3º, I), em centavos. */
export const ME_REVENUE_CAP_CENTS = 36_000_000n;

export const PE_ANTECIPACAO_SIMPLES_META: TableMeta = {
  id: 'pe-antecipacao-simples',
  version: '2026-10-19.1',
  effectiveFrom: '2023-12-01',
  effectiveTo: PE_ANTECIPACAO_SIMPLES_UNTIL,
  sources: [
    { law: 'SEFAZ-PE, informativo "Antecipação tributária: aquisições em outra UF", atualizado em 01/10/2026, itens 2.1.5, 2.2.2 e 2.3.7 (RICMS-PE arts. 338 a 340, 363-A e 393-A)', url: 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/Legislacao/Informativos%20Fiscais/ANTECIPA%C3%87%C3%83O%20TRIBUT%C3%81RIA%20AQUISI%C3%87%C3%95ES%20EM%20OUTRA%20UF.pdf', retrievedAt: '2026-10-19' },
  ],
  validatedBy: null,
  caveats: [
    'O percentual é aplicado sobre o valor da operação (produto, frete, seguro, outras despesas e IPI, menos desconto). O informativo descreve a base com o ICMS da origem excluído e o interno incluído, reduzida para que o imposto corresponda ao percentual: o resultado é ESTIMATIVA até o contador conferir com o extrato do sistema Fronteiras.',
    'ME × demais é deduzido da RBT12 (até R$ 360 mil = ME); a lei usa a condição de inscrição no Cacepe.',
    'A tabela do Agreste com CNAE do Anexo 19 (percentuais menores) não está modelada: a estimativa fica para cima nesses casos.',
    'Contribuinte irregular (art. 393-A) paga a diferença cheia entre a alíquota interna e a interestadual. Sem a informação de regularidade, o cálculo usa esse pior caso.',
    'Só alíquotas internas de 18%, 20,5%, 25% e 27% têm percentual reduzido; as demais seguem a diferença de alíquotas. O cálculo usa a modal de 20,5%: produto com alíquota específica fica fora.',
    'A partir de 2029 o benefício do comércio é reduzido em 20% ao ano (Conv. ICMS 190/2017): os percentuais desses anos ainda não foram publicados.',
  ],
};

// ---------------------------------------------------------------------------------------------------------------------
// ST de pneus, câmaras de ar e protetores (RICMS-PE, Anexo 37, arts. 49 a 54, desde 2023-12-01; Conv. ICMS 142/2018,
// Anexo XVI). MVA original da tabela oficial da SEFAZ-PE "Pneus novos, câmaras de ar e protetores — MVAs a partir de
// 1º de janeiro de 2024"; as ajustadas da mesma tabela batem com a fórmula de `mvaAdjusted` (teste).

export interface PePneuItem {
  item: string;
  cest: string;
  /** NCM como no convênio: vale o prefixo. */
  ncm: string[];
  description: string;
  /** MVA-ST original, operação interna ou de importação. */
  mvaOriginal: string;
}

export const PE_ST_PNEUS: PePneuItem[] = [
  { item: '1.0', cest: '16.001.00', ncm: ['4011.10.00'], description: 'Pneus novos para automóveis de passageiros (inclusive uso misto, camionetas e de corrida)', mvaOriginal: '42' },
  { item: '2.0', cest: '16.002.00', ncm: ['4011.20', '4011.30', '4011.70', '4011.80', '4011.90'], description: 'Pneus novos para caminhões (inclusive fora-de-estrada), ônibus, aviões, máquinas de terraplenagem, construção, agrícolas e pá-carregadeira', mvaOriginal: '32' },
  { item: '3.0', cest: '16.003.00', ncm: ['4011.40.00'], description: 'Pneus novos para motocicletas', mvaOriginal: '60' },
  { item: '4.0', cest: '16.004.00', ncm: ['4011'], description: 'Outros tipos de pneus novos, exceto os do CEST 16.005.00', mvaOriginal: '45' },
  { item: '5.0', cest: '16.005.00', ncm: ['4011.50.00'], description: 'Pneus novos de borracha para bicicletas', mvaOriginal: '105' },
  { item: '7.0', cest: '16.007.00', ncm: ['4012.90'], description: 'Protetores de borracha, exceto os do CEST 16.007.01', mvaOriginal: '45' },
  { item: '8.0', cest: '16.008.00', ncm: ['4013'], description: 'Câmaras de ar de borracha, exceto as do CEST 16.009.00', mvaOriginal: '45' },
  { item: '9.0', cest: '16.009.00', ncm: ['4013.20.00'], description: 'Câmaras de ar de borracha para bicicletas', mvaOriginal: '105' },
];

export const PE_ST_PNEUS_META: TableMeta = {
  id: 'pe-st-pneus',
  version: '2026-10-19.1',
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
  sources: [
    { law: 'SEFAZ-PE, tabela "Pneus novos, câmaras de ar e protetores — MVAs a partir de 1º de janeiro de 2024" (Conv. ICMS 142/2018, Anexo XVI)', url: 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/Legislacao/Tabelas/Tabela%20MVA%20Pneus%20e%20C%C3%A2maras%20de%20Ar.pdf', retrievedAt: '2026-10-19' },
    { law: 'SEFAZ-PE, "Produtos sujeitos ao regime de antecipação/substituição tributária com MVA" (atualizada em 14.10.2026): pneus no RICMS-PE, Anexo 37, arts. 49 a 54, substituição com liberação', url: 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/Legislacao/Tabelas/Produtos_Antecipacao_Tributaria.pdf', retrievedAt: '2026-10-19' },
  ],
  validatedBy: null,
  caveats: [
    'O texto dos arts. 49 a 54 do Anexo 37 não foi lido: a MVA vem da tabela oficial da SEFAZ-PE, e a fórmula da ajustada foi conferida contra ela.',
    'O item 6.0 do Anexo XVI não aparece na tabela da SEFAZ-PE e não está aqui.',
    'Sem CEST, o NCM decide pelo prefixo mais longo; 4011 genérico cai em "outros tipos" (45%). O alerta pede confirmação.',
    'Pneu vindo de fabricante ou importador de outra UF normalmente chega com a ST retida pelo convênio. Nota sem ST: o cálculo supõe que a oficina recolhe na entrada.',
    'O CEST 16.007.01 (exceção do item 7.0) não tem MVA na tabela e não está aqui.',
  ],
};
