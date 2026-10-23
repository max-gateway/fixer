import type { TableMeta } from '../src/types.js';

// Lei 10.485/2002, texto compilado do Planalto lido em 2026-10-13. Revendedor (atacadista ou varejista) tributa PIS e
// Cofins a 0% sobre estes produtos (art. 3º, §2º, I; art. 5º, parágrafo único). Os arts. 1º a 3º, 5º e 6º são
// revogados a partir de 01/01/2027 pela LC 214/2025 (art. 542, XVI), daí o `effectiveTo`.
//
// `prefix` é o NCM só com dígitos: "85.11" -> "8511", "8527.2" -> "85272". Uma posição ou subposição da lei vale
// para todos os NCM que começam por ela (desdobramentos seguem o código-pai: Solução de Consulta Cosit 220/2021).

export type MonofasicoKind =
  /** Código inteiro da lista: vale o regime. */
  | 'FULL'
  /** "Ex" (ex-tarifário): só alguns produtos do código; o NCM não basta para saber. */
  | 'EX_TARIFARIO'
  /** Anexo II: depende do destino ("próprio para máquinas ... posições ..."); o NCM não basta. */
  | 'DESTINO';

export interface MonofasicoEntry {
  prefix: string;
  /** Como está na lei. */
  lawCode: string;
  annex: 'I' | 'II' | 'ART5';
  kind: MonofasicoKind;
  /** Condição do texto legal para as entradas que não são FULL. */
  condition?: string;
}

// "8507.10.00" na lei é o código-pai com todos os desdobramentos (8507.10.10 etc.): o par final "00" não restringe.
const digits = (code: string) => {
  const d = code.replace(/\D/g, '');
  return d.length === 8 && d.endsWith('00') ? d.slice(0, 6) : d;
};
const full = (lawCode: string, annex: 'I' | 'ART5' = 'I'): MonofasicoEntry => ({ prefix: digits(lawCode), lawCode, annex, kind: 'FULL' });
const ex = (lawCode: string, condition: string): MonofasicoEntry => ({ prefix: digits(lawCode), lawCode, annex: 'I', kind: 'EX_TARIFARIO', condition });
const dest = (lawCode: string, condition: string): MonofasicoEntry => ({ prefix: digits(lawCode), lawCode, annex: 'II', kind: 'DESTINO', condition });

const II_MACH = 'próprio para máquinas e veículos das posições 84.29, 8433.20, 8433.30.00, 8433.40.00, 8433.5, 87.01 a 87.06';
const II_MACH_SHORT = 'próprio para máquinas dos códigos 84.29, 8433.20, 8433.30.00, 8433.40.00 e 8433.5';

export const MONOFASICO_AUTOPECAS: MonofasicoEntry[] = [
  // Anexo I
  full('4016.10.10'), ex('4016.99.90', 'Ex 03 e 05'), full('68.13'), full('7007.11.00'), full('7007.21.00'), full('7009.10.00'),
  ex('7320.10.00', 'Ex 01'), full('8301.20.00'), full('8302.30.00'), full('8407.33.90'), full('8407.34.90'), full('8408.20'),
  full('8409.91'), full('8409.99'), full('8413.30'), ex('8413.91.00', 'Ex 01'), full('8414.80.21'), full('8414.80.22'),
  full('8415.20'), full('8421.23.00'), full('8421.31.00'), full('8431.41.00'), full('8431.42.00'), full('8433.90.90'),
  ex('8481.80.99', 'Ex 01 e 02'), full('8483.10'), full('8483.20.00'), full('8483.30'), full('8483.40'), full('8483.50'),
  full('8505.20'), full('8507.10.00'), full('85.11'), full('8512.20'), full('8512.30.00'), full('8512.40'), full('8512.90.00'),
  full('8527.2'), ex('8536.50.90', 'Ex 01'), full('8539.10'), full('8544.30.00'), full('8706.00'), full('87.07'), full('87.08'),
  full('9029.20.10'), full('9029.90.10'), full('9030.39.21'), full('9031.80.40'), full('9032.89.2'), full('9104.00.00'), full('9401.20.00'),
  // Anexo II: todos dependem do destino ou da posição de origem
  dest('40.09', `tubos de borracha vulcanizada não endurecida, com acessórios, ${II_MACH}`),
  dest('84.31', 'partes reconhecíveis como exclusiva ou principalmente destinadas às máquinas da posição 84.29'),
  dest('8408.90.90', `motores ${II_MACH_SHORT}`),
  dest('8412.21.10', `cilindros hidráulicos ${II_MACH_SHORT}`),
  dest('8412.21.90', `outros motores hidráulicos de movimento retilíneo (cilindros) ${II_MACH_SHORT}`),
  dest('8412.31.10', 'cilindros pneumáticos próprios para produtos dos códigos 8701.20.00, 87.02 e 87.04'),
  dest('8413.60.19', 'bombas volumétricas rotativas próprias para produtos dos códigos 84.29, 8433.20, 8433.30.00, 8433.40.00, 8433.5, 8701.20.00, 87.02 e 87.04'),
  dest('8414.80.19', 'compressores de ar próprios para produtos dos códigos 8701.20.00, 87.02 e 87.04'),
  dest('8414.90.39', 'caixas de ventilação para veículos autopropulsados'),
  dest('8432.90.00', 'partes de máquinas das posições 8432.40.00 e 8432.80.00'),
  dest('8481.10.00', `válvulas redutoras de pressão, ${II_MACH}`),
  dest('8481.20.90', `válvulas para transmissões óleo-hidráulicas ou pneumáticas ${II_MACH_SHORT}`),
  dest('8481.80.92', `válvulas solenóides, ${II_MACH}`),
  dest('8483.60.1', `embreagens de fricção ${II_MACH_SHORT}`),
  dest('8501.10.19', 'outros motores de corrente contínua próprios para acionamento elétrico de vidros de veículos autopropulsados'),
  // Art. 5º: pneus novos e câmaras-de-ar
  full('40.11', 'ART5'), full('40.13', 'ART5'),
];

export const MONOFASICO_AUTOPECAS_META: TableMeta = {
  id: 'monofasico-autopecas',
  version: '2026-10-22.2',
  effectiveFrom: '2002-11-01',
  effectiveTo: '2026-12-31',
  sources: [
    { law: 'Lei 10.485/2002, Anexos I e II e art. 5º (texto compilado)', url: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10485compilado.htm', retrievedAt: '2026-10-13' },
    { law: 'LC 214/2025, art. 542, XVI (revoga os arts. 1º a 3º, 5º e 6º da Lei 10.485/2002 a partir de 01/01/2027)', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm', retrievedAt: '2026-10-13' },
  ],
  validatedBy: null,
  caveats: [
    'LC 224/2025, art. 4º: a redução de 90% de isenções e alíquotas zero alcança só o que consta do demonstrativo de gastos tributários da LOA 2026 (IN RFB 2.305/2025, art. 2º). Conferido em 2026-10-22: a planilha do DGT da PLOA 2026 (RFB) não tem linha da Lei 10.485 nem de tributação monofásica, e a IN não a cita; logo o 0% do revendedor (art. 3º, § 2º; art. 5º, parágrafo único) segue valendo. Não foi lido o anexo do DGT da LOA final (janeiro de 2026): se houver diferença, o contador avisa.',
    'Lista do texto da lei. O art. 3º, §1º autoriza o Poder Executivo a alterar a relação por decreto: alterações por decreto posteriores ao texto compilado NÃO foram incluídas. Conferir na TIPI vigente.',
    'Entradas EX_TARIFARIO e DESTINO não se decidem só pelo NCM: exigem confirmação da pessoa.',
    'A lei não se aplica a produtos usados (art. 6º).',
    'Outros monofásicos (medicamentos, combustíveis, bebidas etc.) não estão nesta tabela.',
  ],
};
