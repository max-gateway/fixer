import { parseXml, str, XmlError } from './xml.js';

export interface EventResult {
  accessKey: string | null;
  /** cStat do evento individual: 135 vinculado, 136 não vinculado, 573 duplicidade, 5xx/6xx rejeição. */
  cStat: number;
  xMotivo: string;
  protocol: string | null;
}

export interface EnvEventoResponse {
  /** cStat do lote: 128 = lote processado (o resultado de cada evento vem em `events`). */
  batchStatus: number;
  batchMotivo: string;
  events: EventResult[];
}

/** `retEnvEvento` (NT 2020.001, item 4.3.2), com ou sem o envelope SOAP. */
export function parseEnvEventoResponse(xml: string): EnvEventoResponse {
  const root = parseXml(xml);
  const ret = find(root, 'retEnvEvento');
  if (!ret) throw new XmlError('Resposta sem retEnvEvento');
  const batchStatus = Number(str(ret.cStat));
  if (!Number.isInteger(batchStatus)) throw new XmlError('Resposta sem cStat');

  const list = ret.retEvento === undefined ? [] : Array.isArray(ret.retEvento) ? ret.retEvento : [ret.retEvento];
  const events = list.map((e: Record<string, any>): EventResult => {
    const info = e.infEvento ?? {};
    const cStat = Number(str(info.cStat));
    return {
      accessKey: str(info.chNFe) ?? null,
      cStat: Number.isInteger(cStat) ? cStat : 0,
      xMotivo: str(info.xMotivo) ?? '',
      protocol: str(info.nProt) ?? null,
    };
  });
  return { batchStatus, batchMotivo: str(ret.xMotivo) ?? '', events };
}

function find(node: unknown, name: string): Record<string, any> | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, any>;
  if (name in obj && typeof obj[name] === 'object') return obj[name];
  for (const value of Object.values(obj)) {
    const found = find(value, name);
    if (found) return found;
  }
  return null;
}
