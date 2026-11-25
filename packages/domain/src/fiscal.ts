// Validação fiscal de peça (NF-e/NFC-e) e de serviço (NFS-e) antes de emitir
// (docs/specs/service-catalog.md §4.3 e §4.3.1). Funções puras: devolvem a lista de pendências,
// vazia = pronto. Nenhum código fiscal é inventado aqui; só se confere formato e consistência.

export type TaxRegimeCode = 'SIMPLES' | 'PRESUMIDO' | 'REAL';

export interface FiscalIssue {
  field: string;
  message: string;
}

export interface PartFiscal {
  ncm: string | null;
  cest: string | null;
  originCode: number | null;
  unit: string | null;
  defaultCfop: string | null;
  csosn: string | null;
  cst: string | null;
  fiscalVerified: boolean;
}

export interface ServiceFiscalProfileLike {
  lc116Item: string;
  nbs: string | null;
  verified: boolean;
}

export interface TenantFiscalLike {
  municipalityIbge: string | null;
  taxRegime: TaxRegimeCode | null;
  issRate: number | null;
  municipalServiceCode: string | null;
  hourlyRate: number | null;
}

const CSOSN = new Set(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']);
/** Venda de mercadoria adquirida com ICMS já retido por substituição tributária. */
const ST_CFOPS = new Set(['5405', '6405']);

const issue = (field: string, message: string): FiscalIssue => ({ field, message });

export function partFiscalIssues(part: PartFiscal, regime: TaxRegimeCode | null): FiscalIssue[] {
  const out: FiscalIssue[] = [];

  if (!part.ncm) out.push(issue('ncm', 'NCM obrigatório'));
  else if (!/^\d{8}$/.test(part.ncm)) out.push(issue('ncm', 'NCM deve ter 8 dígitos, sem pontuação'));

  if (part.cest && !/^\d{7}$/.test(part.cest)) out.push(issue('cest', 'CEST deve ter 7 dígitos, sem pontuação'));

  if (part.originCode == null) out.push(issue('originCode', 'Origem da mercadoria obrigatória (0 a 8)'));
  else if (!Number.isInteger(part.originCode) || part.originCode < 0 || part.originCode > 8) {
    out.push(issue('originCode', 'Origem da mercadoria deve ser um número de 0 a 8'));
  }

  if (!part.unit) out.push(issue('unit', 'Unidade comercial obrigatória'));
  else if (part.unit.length > 6) out.push(issue('unit', 'Unidade comercial com até 6 caracteres'));

  if (!part.defaultCfop) out.push(issue('defaultCfop', 'CFOP de venda obrigatório'));
  else if (!/^[567]\d{3}$/.test(part.defaultCfop)) {
    out.push(issue('defaultCfop', 'CFOP de venda deve começar com 5, 6 ou 7'));
  }

  const isSt = part.defaultCfop != null && ST_CFOPS.has(part.defaultCfop);
  if (isSt && !part.cest) out.push(issue('cest', 'CEST obrigatório quando o CFOP indica substituição tributária'));

  if (regime === null) {
    out.push(issue('taxRegime', 'Regime tributário da oficina não configurado'));
  } else if (regime === 'SIMPLES') {
    if (!part.csosn) out.push(issue('csosn', 'CSOSN obrigatório no Simples Nacional'));
    else if (!CSOSN.has(part.csosn)) out.push(issue('csosn', 'CSOSN inválido'));
    else if (isSt && part.csosn !== '500') {
      out.push(issue('csosn', 'Com CFOP de substituição tributária o CSOSN deve ser 500'));
    } else if (!isSt && part.csosn === '500') {
      out.push(issue('csosn', 'CSOSN 500 só se aplica a mercadoria com ICMS retido por substituição (CFOP 5405/6405)'));
    }
  } else if (!part.cst || !/^\d{2}$/.test(part.cst)) {
    out.push(issue('cst', 'CST obrigatório (2 dígitos) fora do Simples Nacional'));
  }

  if (!part.fiscalVerified) out.push(issue('fiscalVerified', 'Dados fiscais ainda não confirmados pelo contador'));
  return out;
}

export function serviceFiscalIssues(profile: ServiceFiscalProfileLike | null): FiscalIssue[] {
  if (!profile) return [issue('fiscalProfile', 'Serviço sem perfil fiscal (item LC 116)')];
  const out: FiscalIssue[] = [];
  if (!/^\d{1,2}\.\d{2}$/.test(profile.lc116Item)) out.push(issue('lc116Item', 'Item da LC 116 inválido (ex.: 14.01)'));
  if (!profile.nbs) out.push(issue('nbs', 'NBS obrigatório na NFS-e'));
  else if (!/^\d\.\d{4}\.\d{2}\.\d{2}$/.test(profile.nbs)) out.push(issue('nbs', 'NBS inválido (formato 1.2001.31.00)'));
  if (!profile.verified) out.push(issue('fiscalProfile.verified', 'Perfil fiscal do serviço ainda não confirmado pelo contador'));
  return out;
}

/** Dados municipais necessários para a NFS-e. O valor-hora não entra: só afeta o preço, não a nota. */
export function settingsFiscalIssues(settings: TenantFiscalLike | null): FiscalIssue[] {
  const out: FiscalIssue[] = [];
  if (!settings?.municipalityIbge) out.push(issue('municipalityIbge', 'Município (código IBGE) não configurado'));
  else if (!/^\d{7}$/.test(settings.municipalityIbge)) out.push(issue('municipalityIbge', 'Código IBGE do município deve ter 7 dígitos'));
  if (!settings?.taxRegime) out.push(issue('taxRegime', 'Regime tributário não configurado'));
  if (settings?.issRate == null) out.push(issue('issRate', 'Alíquota de ISS não configurada'));
  else if (!(settings.issRate > 0 && settings.issRate <= 5)) out.push(issue('issRate', 'Alíquota de ISS deve ser maior que 0 e no máximo 5%'));
  if (!settings?.municipalServiceCode) out.push(issue('municipalServiceCode', 'Código de tributação municipal não configurado'));
  return out;
}
