import type { TableMeta } from '../src/types.js';

// Item da lista de serviços da LC 116/2003 para as atividades de oficina (CNAE 2.3, subclasses do IBGE). Não existe tabela
// nacional oficial de correspondência CNAE × LC 116: cada prefeitura publica a sua. O vínculo abaixo é REGRA DO FIXER,
// tirada do texto do item 14.01 ("conserto, restauração, manutenção e conservação de [...] veículos"); o texto do item e as
// descrições das subclasses são oficiais. Uso: preencher o serviço padrão da oficina pela CNAE principal
// (docs/specs/fiscal-autofill.md §5.1), sempre como "inferido" até o contador confirmar.

export interface CnaeServiceEntry {
  /** Subclasse CNAE, 7 dígitos, sem máscara. */
  cnae: string;
  /** Descrição oficial do IBGE (CNAE 2.3). */
  description: string;
  /** Item da lista da LC 116/2003. */
  lc116Item: string;
}

/** Texto oficial do item 14.01 da lista anexa à LC 116/2003. */
export const LC116_ITEM_14_01 =
  'Lubrificação, limpeza, lustração, revisão, carga e recarga, conserto, restauração, blindagem, manutenção e conservação de máquinas, veículos, aparelhos, equipamentos, motores, elevadores ou de qualquer objeto (exceto peças e partes empregadas, que ficam sujeitas ao ICMS).';

export const CNAE_LC116: CnaeServiceEntry[] = [
  { cnae: '4520001', description: 'SERVIÇOS DE MANUTENÇÃO E REPARAÇÃO MECÂNICA DE VEÍCULOS AUTOMOTORES', lc116Item: '14.01' },
  { cnae: '4520002', description: 'SERVIÇOS DE LANTERNAGEM OU FUNILARIA E PINTURA DE VEÍCULOS AUTOMOTORES', lc116Item: '14.01' },
  { cnae: '4520003', description: 'SERVIÇOS DE MANUTENÇÃO E REPARAÇÃO ELÉTRICA DE VEÍCULOS AUTOMOTORES', lc116Item: '14.01' },
  { cnae: '4520004', description: 'SERVIÇOS DE ALINHAMENTO E BALANCEAMENTO DE VEÍCULOS AUTOMOTORES', lc116Item: '14.01' },
  { cnae: '4520005', description: 'SERVIÇOS DE LAVAGEM, LUBRIFICAÇÃO E POLIMENTO DE VEÍCULOS AUTOMOTORES', lc116Item: '14.01' },
  { cnae: '4520006', description: 'SERVIÇOS DE BORRACHARIA PARA VEÍCULOS AUTOMOTORES', lc116Item: '14.01' },
  { cnae: '4520007', description: 'SERVIÇOS DE INSTALAÇÃO, MANUTENÇÃO E REPARAÇÃO DE ACESSÓRIOS PARA VEÍCULOS AUTOMOTORES', lc116Item: '14.01' },
  { cnae: '4520008', description: 'SERVIÇOS DE CAPOTARIA', lc116Item: '14.01' },
  { cnae: '4543900', description: 'MANUTENÇÃO E REPARAÇÃO DE MOTOCICLETAS E MOTONETAS', lc116Item: '14.01' },
];

export const CNAE_LC116_META: TableMeta = {
  id: 'cnae-lc116',
  version: '2026-10-19.2',
  effectiveFrom: '2004-01-01',
  effectiveTo: null,
  sources: [
    { law: 'LC 116/2003, lista de serviços, item 14.01', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm', retrievedAt: '2026-10-19' },
    { law: 'CNAE 2.3 (IBGE/CONCLA), classes 45.20-0 e 45.43-9', url: 'https://servicodados.ibge.gov.br/api/v2/cnae/classes/45200/subclasses', retrievedAt: '2026-10-19' },
  ],
  validatedBy: null,
  caveats: [
    'O vínculo CNAE → item é regra do Fixer: não há tabela nacional, e a prefeitura pode exigir outro item (ex.: 14.05 para funilaria e pintura, 14.06 para instalação de acessórios).',
    'Vale a CNAE principal; se ela não for serviço (ex.: autopeças), vale a primeira secundária da tabela. Com mais de um serviço, só o primeiro entra.',
    'CNAE de comércio de peças (45.30) não é serviço: a venda de peça é ICMS, sem item da LC 116.',
    'O código de tributação nacional da NFS-e (desdobramento do item) não está aqui: vem dos parâmetros municipais (docs/specs/nfse-parametros-municipais.md).',
  ],
};
