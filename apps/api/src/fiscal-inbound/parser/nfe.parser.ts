import { isValidAccessKey, normalizeCnpj } from '../cnpj.js';
import { parseXml, str, XmlError } from './xml.js';

export interface ParsedNfeItem {
  itemNumber: number;
  supplierCode: string;
  ean: string | null;
  description: string;
  ncm: string;
  cest: string | null;
  origin: number | null;
  cfop: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  discount: string;
  freight: string;
  insurance: string;
  otherCosts: string;
  ipi: string;
  icmsSt: string;
}

export interface ParsedNfe {
  /** Chave de `infNFe/@Id` (sem o prefixo `NFe`). */
  accessKey: string;
  /** Chave de `protNFe/infProt/chNFe`, quando há protocolo. */
  protocolKey: string | null;
  /** `cStat` do protocolo de autorização (100 = autorizada). */
  protocolStatus: number | null;
  model: number | null;
  series: number | null;
  number: number | null;
  issuedAt: Date | null;
  /** tpNF: 0 entrada, 1 saída do emitente. */
  operationType: number | null;
  /** finNFe: 1 normal, 2 complementar, 3 ajuste, 4 devolução. */
  finality: number | null;
  issuerId: string;
  issuerName: string;
  /** CNPJ ou CPF do destinatário; null para estrangeiro/consumidor sem documento. */
  recipientId: string | null;
  totalAmount: string;
  items: ParsedNfeItem[];
}

/**
 * Valores monetários e quantidades ficam como string decimal exatamente como no XML (o Prisma recebe
 * string em `Decimal`); nada passa por `Number`, então não há erro de ponto flutuante.
 */
export function parseProcNfe(xml: string): ParsedNfe {
  const root = parseXml(xml);
  const nfe = root.nfeProc?.NFe ?? root.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new XmlError('XML sem infNFe');

  const accessKey = (str(inf['@_Id']) ?? '').replace(/^NFe/, '');
  const dets: Record<string, any>[] = inf.det ?? [];
  const prot = root.nfeProc?.protNFe?.infProt;

  return {
    accessKey,
    protocolKey: str(prot?.chNFe) ?? null,
    protocolStatus: prot?.cStat ? Number(prot.cStat) : null,
    model: intOrNull(inf.ide?.mod),
    series: intOrNull(inf.ide?.serie),
    number: intOrNull(inf.ide?.nNF),
    issuedAt: dateOrNull(inf.ide?.dhEmi ?? inf.ide?.dEmi),
    operationType: intOrNull(inf.ide?.tpNF),
    finality: intOrNull(inf.ide?.finNFe),
    issuerId: normalizeCnpj(str(inf.emit?.CNPJ) ?? str(inf.emit?.CPF) ?? ''),
    issuerName: str(inf.emit?.xNome) ?? '',
    recipientId: (() => {
      const id = str(inf.dest?.CNPJ) ?? str(inf.dest?.CPF);
      return id ? normalizeCnpj(id) : null;
    })(),
    totalAmount: str(inf.total?.ICMSTot?.vNF) ?? '0',
    items: dets.map(parseItem),
  };
}

function parseItem(det: Record<string, any>): ParsedNfeItem {
  const p = det.prod ?? {};
  const icms = firstChild(det.imposto?.ICMS);
  return {
    itemNumber: Number(det['@_nItem']),
    supplierCode: str(p.cProd) ?? '',
    ean: itemGtin(p),
    description: str(p.xProd) ?? '',
    ncm: str(p.NCM) ?? '',
    cest: str(p.CEST) ?? null,
    origin: intOrNull(icms?.orig),
    cfop: str(p.CFOP) ?? '',
    unit: str(p.uCom) ?? '',
    quantity: str(p.qCom) ?? '0',
    unitPrice: str(p.vUnCom) ?? '0',
    totalPrice: str(p.vProd) ?? '0',
    discount: str(p.vDesc) ?? '0',
    freight: str(p.vFrete) ?? '0',
    insurance: str(p.vSeg) ?? '0',
    otherCosts: str(p.vOutro) ?? '0',
    ipi: str(det.imposto?.IPI?.IPITrib?.vIPI) ?? '0',
    // Só o ST cobrado nesta nota (ICMS10/30/70/90, ICMSSN201/202/900). `vICMSSTRet` (ICMS60) é ST já
    // retido numa etapa anterior: informativo, não compõe o custo desta compra.
    icmsSt: str(icms?.vICMSST) ?? '0',
  };
}

/** O grupo ICMS tem um filho que varia (ICMS00, ICMS10, ICMSSN102...); devolve o conteúdo dele. */
function firstChild(group: unknown): Record<string, any> | undefined {
  if (!group || typeof group !== 'object') return undefined;
  const first = Object.values(group as Record<string, unknown>)[0];
  return first && typeof first === 'object' ? (first as Record<string, any>) : undefined;
}

/**
 * GTIN do item. O `cEAN` identifica a unidade COMERCIAL (`uCom`/`qCom`), a mesma em que o item é lançado,
 * então serve direto. O `cEANTrib` identifica a unidade TRIBUTÁVEL: só é usado quando ela coincide com a
 * comercial (mesma unidade e quantidade); caso contrário casar por ele erraria a quantidade (ex.: caixa
 * de 4 comercial, unidade tributável avulsa).
 */
function itemGtin(p: Record<string, any>): string | null {
  const commercial = gtin(str(p.cEAN));
  if (commercial) return commercial;
  const sameUnit = str(p.uTrib) === str(p.uCom) && Number(str(p.qTrib)) === Number(str(p.qCom));
  return sameUnit ? gtin(str(p.cEANTrib)) : null;
}

/** GTIN válido tem 8, 12, 13 ou 14 dígitos; "SEM GTIN" e variações viram null. */
function gtin(v: string | undefined): string | null {
  return v && /^\d{8}$|^\d{12,14}$/.test(v) ? v : null;
}

const intOrNull = (v: unknown): number | null => {
  const s = str(v);
  return s && /^-?\d+$/.test(s) ? Number(s) : null;
};

const dateOrNull = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export type NfeVerdict =
  | { ok: true; needsReview: boolean }
  | { ok: false; reason: 'INVALID_KEY' | 'KEY_MISMATCH' | 'NOT_RECIPIENT' | 'NOT_INBOUND' | 'NOT_AUTHORIZED' | 'NO_ITEMS' };

/**
 * Regras de §6.3: a nota só segue o fluxo automático se a chave é íntegra, somos o destinatário, ela é
 * saída do emitente (nossa compra) e está autorizada. Finalidade diferente de 1 passa, mas exige revisão.
 * `tenantCnpj` é o CNPJ de 14 posições cadastrado em TenantFiscalSettings; a comparação é exata: nota para
 * outro estabelecimento da mesma raiz não é compra deste tenant (a distribuição devolve as de todos).
 */
export function assessNfe(nfe: ParsedNfe, tenantCnpj: string): NfeVerdict {
  if (!isValidAccessKey(nfe.accessKey)) return { ok: false, reason: 'INVALID_KEY' };
  if (nfe.protocolKey && nfe.protocolKey !== nfe.accessKey) return { ok: false, reason: 'KEY_MISMATCH' };
  // Posições 7–20 da chave (índices 6..19) carregam o CNPJ do emitente.
  if (nfe.issuerId.length === 14 && nfe.accessKey.slice(6, 20) !== nfe.issuerId) return { ok: false, reason: 'KEY_MISMATCH' };
  if (nfe.recipientId !== tenantCnpj) {
    return { ok: false, reason: 'NOT_RECIPIENT' };
  }
  if (nfe.operationType !== 1) return { ok: false, reason: 'NOT_INBOUND' };
  if (nfe.protocolStatus !== 100) return { ok: false, reason: 'NOT_AUTHORIZED' };
  if (nfe.items.length === 0) return { ok: false, reason: 'NO_ITEMS' };
  return { ok: true, needsReview: nfe.finality !== 1 };
}
