import { normalizeCnpj } from '../cnpj.js';
import { parseXml, str, XmlError } from './xml.js';

export interface ParsedResNfe {
  accessKey: string;
  issuerId: string;
  issuerName: string;
  issuedAt: Date | null;
  /** tpNF: 1 = saída do emitente. */
  operationType: number | null;
  totalAmount: string;
  /** cSitNFe: 1 autorizada, 2 denegada, 3 cancelada. */
  situation: number | null;
}

/** Resumo de NF-e (`resNFe`): o que a SEFAZ entrega ao destinatário antes da manifestação. Não traz itens nem destinatário. */
export function parseResNfe(xml: string): ParsedResNfe {
  const r = parseXml(xml).resNFe;
  const accessKey = str(r?.chNFe);
  if (!accessKey) throw new XmlError('resNFe sem chNFe');
  const date = str(r.dhEmi) ? new Date(r.dhEmi) : null;
  return {
    accessKey,
    issuerId: normalizeCnpj(str(r.CNPJ) ?? str(r.CPF) ?? ''),
    issuerName: str(r.xNome) ?? '',
    issuedAt: date && !Number.isNaN(date.getTime()) ? date : null,
    operationType: str(r.tpNF) ? Number(r.tpNF) : null,
    totalAmount: str(r.vNF) ?? '0',
    situation: str(r.cSitNFe) ? Number(r.cSitNFe) : null,
  };
}

export interface ParsedEvent {
  accessKey: string;
  eventType: string;
  /** cStat do `retEvento` (135/155 cancelam; ver CANCEL_OK_STATUS); null quando o documento é só um resumo. */
  status: number | null;
}

/** Evento de NF-e, tanto o resumo (`resEvento`) quanto o completo (`procEventoNFe`). */
export function parseEvent(xml: string): ParsedEvent {
  const root = parseXml(xml);
  const full = root.procEventoNFe;
  const info = full?.evento?.infEvento ?? root.resEvento;
  const accessKey = str(info?.chNFe);
  const eventType = str(info?.tpEvento);
  if (!accessKey || !eventType) throw new XmlError('Evento sem chNFe/tpEvento');
  const ret = full?.retEvento?.infEvento?.cStat;
  return { accessKey, eventType, status: str(ret) ? Number(ret) : null };
}

/** Eventos de cancelamento de NF-e. */
export const EVENT_CANCEL = '110111';
/**
 * `cStat` de cancelamento efetivo: 135 (evento registrado e vinculado à NF-e) e 155 (cancelamento
 * homologado fora de prazo). 136 (registrado, mas não vinculado) não cancela. Valores de memória:
 * conferir no leiaute de eventos (docs/specs/nfe-import.md §14.3).
 */
export const CANCEL_OK_STATUS = new Set([135, 155]);
