import type { TableMeta } from '../src/types.js';

// Protocolo ICMS 41/2008 (ST nas operações interestaduais com autopeças): a quais UFs de DESTINO o remetente retém o
// ICMS-ST, por período, e quais CEST ficam de fora. Lido do texto consolidado do Confaz em 2026-10-13, com a redação do
// caput da cláusula primeira dada pelos Prots. ICMS 95/22, 32/24 e 93/26. A UF de origem também precisa ser signatária
// (cláusula primeira, preâmbulo e adesões: AL, RJ, ES, GO, DF, AC, PB, RR); esta tabela guarda só o destino, que é o que
// o comprador (a oficina) pode conferir.

export interface StProtocolPeriod {
  from: string;
  to: string | null;
  /** UFs de destino a que se aplica a retenção pelo remetente. */
  destinations: string[];
  /** CEST do Anexo II do Conv. ICMS 142/2018 que ficam fora do protocolo. */
  excludedCest: string[];
  /** Prot. ICMS que deu a redação. */
  amendedBy: string;
}

const EXCLUDED = ['01.019.00', '01.062.01', '01.112.00', '01.127.00', '01.128.00', '01.999.00'];

export const ST_AUTOPECAS_PROTOCOLO: StProtocolPeriod[] = [
  {
    from: '2023-02-01',
    to: '2024-10-31',
    destinations: ['AC', 'AL', 'AP', 'AM', 'BA', 'MA', 'MT', 'MG', 'PA', 'PB', 'PR', 'PI', 'RJ', 'RR', 'RS', 'SP', 'DF'],
    excludedCest: EXCLUDED,
    amendedBy: 'Prot. ICMS 95/22',
  },
  {
    from: '2024-11-01',
    to: '2026-09-30',
    destinations: ['AC', 'AL', 'AP', 'AM', 'BA', 'MA', 'MT', 'MG', 'PA', 'PB', 'PR', 'PI', 'RJ', 'RR', 'SP', 'DF'],
    excludedCest: EXCLUDED,
    amendedBy: 'Prot. ICMS 32/24 (exclui o RS)',
  },
  {
    from: '2026-10-01',
    to: null,
    destinations: ['AC', 'AL', 'AP', 'AM', 'BA', 'MA', 'MT', 'MG', 'PA', 'PB', 'PR', 'PI', 'RJ', 'RR', 'DF'],
    excludedCest: EXCLUDED,
    amendedBy: 'Prot. ICMS 93/26 (exclui SP)',
  },
];

export const ST_AUTOPECAS_PROTOCOLO_META: TableMeta = {
  id: 'st-autopecas-protocolo',
  version: '2026-10-13.1',
  effectiveFrom: '2023-02-01',
  effectiveTo: null,
  sources: [
    { law: 'Protocolo ICMS 41/2008 (texto consolidado, cláusula primeira)', url: 'https://www.confaz.fazenda.gov.br/legislacao/protocolos/2008/pt041_08', retrievedAt: '2026-10-13' },
    { law: 'Protocolo ICMS 41/2024 (altera o Protocolo ICMS 22/2008, entre CE e SP)', url: 'https://www.confaz.fazenda.gov.br/legislacao/protocolos/2024/PT041_24', retrievedAt: '2026-10-13' },
  ],
  validatedBy: null,
  caveats: [
    'Antes de 2023-02-01 o protocolo usava outra lista de produtos (Anexo Único) e outras UFs: não há dado aqui.',
    'O texto consolidado do Confaz diz "efeitos a partir de 01.10.24" na redação dada pelo Prot. ICMS 93/26, mas a redação anterior termina em 30.09.26 e a nota de rodapé dá a exclusão de SP "a partir de 01.10.26": usada a data 2026-10-01.',
    'Os §§ 2º e 3º trazem exceções (remessa a estabelecimento industrial ou a outro do mesmo titular; uso e consumo; ativo) que dependem da natureza da operação e não do NCM.',
    'Só vale se a mercadoria também estiver sujeita à ST nas operações internas da UF de destino (§ 1º): o protocolo não prova a ST, o XML sim.',
    'O Protocolo ICMS 22/2008 (CE e SP) é outro instrumento e não está modelado.',
  ],
};
