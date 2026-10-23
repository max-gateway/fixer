// SUBSTITUÍDO por data/simples-anexos.ts (Anexos II a V completos, conferidos contra a LC 123 e a LC 214 em 2026-10-22; esta tabela
// bate com o Anexo III dele nas faixas 1 a 4). Mantido só para `simplesServicoRate` (@deprecated) até os consumidores migrarem.
//
// Simples Nacional, Anexo III (serviços e locação de bens móveis, p.ex. manutenção e reparação de automóveis): alíquotas nominais,
// parcelas a deduzir e repartição dos tributos. LC 123/2006, Anexo III, redação da LC 155/2016 (vigência desde 2018-01-01).
//
// ESTADO DA CONFERÊNCIA: tabela NÃO registrada em `TABLES` nem carimbada por `verify:sources` — o Planalto não respondeu na
// sessão em que foi transcrita (2026-10-21). O que sustenta os valores até a conferência oficial:
//   1. duas fontes secundárias com a mesma tabela (buscadorncm.com.br, jornalcontabil.com.br);
//   2. cada linha de repartição soma 100;
//   3. a 3ª faixa reproduz, tributo a tributo, uma declaração real do PGDAS-D de 2026-09 (alíquota efetiva 9,1318%, e 6,1641% com
//      ISS retido): ver simples-servicos.spec.ts.
// Por isso o consumidor (conferência da declaração) só relata; nada de preço depende desta tabela ainda.
//
// Só as faixas 1 a 4 (RBT12 até R$ 1,8 milhão). A 5ª e a 6ª têm o ISS limitado a 5% da receita com redistribuição do excedente
// (LC 123, art. 18, § 14), regra que as fontes secundárias não trazem de forma consistente: acima de R$ 1,8 milhão a função
// devolve null em vez de arriscar um número. De 2027 em diante o Anexo III muda (LC 214/2025, Anexo XVIII): sem tabela, null.

export interface ServicoShare {
  irpj: string;
  csll: string;
  cofins: string;
  pis: string;
  cpp: string;
  iss: string;
}

export interface ServicoBracket {
  bracket: 1 | 2 | 3 | 4;
  /** Limite superior da RBT12, em centavos, inclusive. */
  upToCents: bigint;
  nominalPct: string;
  /** Parcela a deduzir, em centavos. */
  deductionCents: bigint;
  /** Repartição da alíquota efetiva, em % da própria alíquota (soma 100). */
  share: ServicoShare;
}

const share = (cofins: string, pis: string, iss: string): ServicoShare => ({ irpj: '4.00', csll: '3.50', cofins, pis, cpp: '43.40', iss });

export const SIMPLES_SERVICOS_ANEXO_III = {
  id: 'LC123-AnexoIII-2018',
  from: '2018-01-01',
  to: '2026-12-31',
  source: 'LC 123/2006, Anexo III (redação da LC 155/2016), faixas 1 a 4',
  brackets: [
    { bracket: 1, upToCents: 18_000_000n, nominalPct: '6.00', deductionCents: 0n, share: share('12.82', '2.78', '33.50') },
    { bracket: 2, upToCents: 36_000_000n, nominalPct: '11.20', deductionCents: 936_000n, share: share('14.05', '3.05', '32.00') },
    { bracket: 3, upToCents: 72_000_000n, nominalPct: '13.50', deductionCents: 1_764_000n, share: share('13.64', '2.96', '32.50') },
    { bracket: 4, upToCents: 180_000_000n, nominalPct: '16.00', deductionCents: 3_564_000n, share: share('13.64', '2.96', '32.50') },
  ] satisfies ServicoBracket[],
};
