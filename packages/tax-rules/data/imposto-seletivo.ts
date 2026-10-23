import type { TableMeta } from '../src/types.js';

// Imposto Seletivo: bens sujeitos (LC 214/2025, Anexo XVII). As alíquotas são de lei ordinária (arts. 419, 421 e 422) e o pacote
// não tem nenhuma: a função devolve a incidência e `ALIQUOTA_NAO_FIXADA`. Lido do Planalto em 2026-10-22.

export type SeletivoCategory = 'VEICULOS' | 'AERONAVES_EMBARCACOES' | 'FUMIGENOS' | 'BEBIDAS_ALCOOLICAS' | 'BEBIDAS_ACUCARADAS' | 'BENS_MINERAIS';

export interface SeletivoEntry {
  category: SeletivoCategory;
  /** Prefixo de NCM (dígitos): "8703" pega a posição inteira. */
  ncmPrefix: string;
  /** Exceção do anexo que a NCM sozinha não resolve ("exceto os caminhões"): a incidência depende de quem chama (status DEPENDE). */
  condition?: string;
  /** Ressalva do anexo que não muda a resposta por NCM (uso operacional das Forças Armadas e da Segurança Pública): vai como aviso. */
  carveOut?: string;
  /** Prefixos de NCM excluídos pelo próprio anexo ("exceto o código 8802.60.00"). */
  exceptNcm?: string[];
  /** Alíquota específica somada à ad valorem (art. 422, § 1º). */
  specificRate?: boolean;
}

const MILITAR = 'ressalvados os bens com características técnicas específicas para uso operacional das Forças Armadas ou dos órgãos de Segurança Pública';
const TRUCK = 'exceto os caminhões';

export const SELETIVO: SeletivoEntry[] = [
  { category: 'VEICULOS', ncmPrefix: '8703', carveOut: MILITAR },
  { category: 'VEICULOS', ncmPrefix: '870421', condition: TRUCK, carveOut: MILITAR },
  { category: 'VEICULOS', ncmPrefix: '870431', condition: TRUCK, carveOut: MILITAR },
  { category: 'VEICULOS', ncmPrefix: '87044100', condition: TRUCK, carveOut: MILITAR },
  { category: 'VEICULOS', ncmPrefix: '87045100', condition: TRUCK, carveOut: MILITAR },
  { category: 'VEICULOS', ncmPrefix: '87046000', condition: TRUCK, carveOut: MILITAR },
  { category: 'VEICULOS', ncmPrefix: '87049000', condition: TRUCK, carveOut: MILITAR },
  { category: 'AERONAVES_EMBARCACOES', ncmPrefix: '8802', exceptNcm: ['88026000'], carveOut: MILITAR },
  { category: 'AERONAVES_EMBARCACOES', ncmPrefix: '8903', carveOut: MILITAR },
  { category: 'FUMIGENOS', ncmPrefix: '2401' },
  { category: 'FUMIGENOS', ncmPrefix: '2402', specificRate: true },
  { category: 'FUMIGENOS', ncmPrefix: '2403' },
  { category: 'FUMIGENOS', ncmPrefix: '2404' },
  { category: 'BEBIDAS_ALCOOLICAS', ncmPrefix: '2203', specificRate: true },
  { category: 'BEBIDAS_ALCOOLICAS', ncmPrefix: '2204', specificRate: true },
  { category: 'BEBIDAS_ALCOOLICAS', ncmPrefix: '2205', specificRate: true },
  { category: 'BEBIDAS_ALCOOLICAS', ncmPrefix: '2206', specificRate: true },
  { category: 'BEBIDAS_ALCOOLICAS', ncmPrefix: '2208', specificRate: true },
  { category: 'BEBIDAS_ACUCARADAS', ncmPrefix: '22021000' },
  { category: 'BENS_MINERAIS', ncmPrefix: '2601' },
  { category: 'BENS_MINERAIS', ncmPrefix: '27090010' },
  { category: 'BENS_MINERAIS', ncmPrefix: '27111100' },
  { category: 'BENS_MINERAIS', ncmPrefix: '27112100' },
];

export const SELETIVO_META: TableMeta = {
  id: 'imposto-seletivo',
  version: '2026-10-22.1',
  effectiveFrom: '2027-01-01',
  effectiveTo: null,
  sources: [{ law: 'LC 214/2025, arts. 409 a 436 e Anexo XVII', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm', retrievedAt: '2026-10-22' }],
  validatedBy: null,
  caveats: [
    'As alíquotas do Imposto Seletivo são de lei ordinária (arts. 419, 421 e 422), que o pacote não tem: a função devolve a incidência e ALIQUOTA_NAO_FIXADA. Conferir se a lei já foi publicada antes de calcular valor.',
    'O início da cobrança (2027-01-01) vem da EC 132/2023 e não é repetido no Anexo XVII; conferir com o contador.',
    'O Imposto Seletivo não incide sobre energia elétrica, telecomunicações e bens com alíquota reduzida pelo art. 9º, § 1º da EC 132 (art. 413), nem na exportação (exceto bens minerais): decisão de quem chama.',
    'Os serviços de concursos de prognósticos e fantasy sport do Anexo XVII não têm NCM e não são modelados; autopeças e acessórios não estão no anexo (só o veículo inteiro, posição 87.03 e caminhonetes/camionetes listadas).',
    'A base de cálculo é o valor de venda (arts. 414 e seguintes), por fora do preço quando o IS integra a base de IBS/CBS: o cálculo de valor depende da alíquota e fica para quando ela existir.',
  ],
};
