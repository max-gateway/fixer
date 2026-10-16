import { CFOP, type CfopEntry } from '../data/cfop.js';

export type CfopProfile = 'RESALE' | 'NOT_RESALE' | 'UNKNOWN';

const BY_CODE = new Map<string, CfopEntry>(CFOP.map((e) => [e.code, e]));

/** O CFOP existe na tabela do Confaz vigente (4 dígitos, com ou sem ponto)? Devolve a entrada. */
export function cfopInfo(cfop: string | null | undefined): CfopEntry | null {
  const code = (cfop ?? '').replace(/\D/g, '');
  const e = BY_CODE.get(code);
  return e && !e.group ? e : null;
}

// Regra do Fixer sobre os códigos do Confaz (não é texto legal): os três últimos dígitos dizem a natureza; o primeiro só
// diz entrada/saída e dentro/fora da UF. Compra para revenda vista pelo comprador = venda de mercadoria pelo emitente.
export const CFOP_RESALE_NATURES = new Set([
  '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', // venda de produção/mercadoria adquirida
  '401', '402', '403', '405', // venda com substituição tributária (substituto e substituído)
]);

export const CFOP_NOT_RESALE_NATURES = new Set([
  '151', '152', '153', '155', '156', // transferência
  '201', '202', '208', '209', '210', // devolução de compra
  '551', '552', '553', '554', '555', '556', '557', // ativo imobilizado e material de uso/consumo
  '910', // bonificação, doação ou brinde
  '911', // amostra grátis
  '912', '913', // demonstração
  '915', '916', // conserto
  '917', '918', '919', // consignação
  '920', '921', '922', '923', '924', '925', // vasilhame, entrega futura, conta e ordem, industrialização
  '949', // outra saída não especificada
]);

export function cfopProfile(cfop: string): CfopProfile {
  const nature = cfop.length === 4 ? cfop.slice(1) : '';
  if (CFOP_NOT_RESALE_NATURES.has(nature)) return 'NOT_RESALE';
  if (CFOP_RESALE_NATURES.has(nature)) return 'RESALE';
  return 'UNKNOWN';
}
