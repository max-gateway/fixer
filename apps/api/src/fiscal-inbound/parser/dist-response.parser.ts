import { gunzipSync } from 'node:zlib';
import { MAX_XML_BYTES, parseXml, str, XmlError } from './xml.js';

export interface DistDocument {
  /** Facultativo na NT desde a v1.15; quando ausente, só o `ultNsu` do lote vale. */
  nsu: bigint | null;
  /** Ex.: `resNFe_v1.00.xsd`, `procNFe_v4.00.xsd`. Casar por prefixo, nunca por versão. */
  schema: string;
  /** XML já descomprimido. Vazio quando `error` está preenchido. */
  xml: string;
  error?: string;
}

export interface DistResult {
  /** Ambiente de recepção: 1 produção, 2 homologação. */
  tpAmb: number | null;
  cStat: number;
  xMotivo: string;
  ultNsu: bigint | null;
  maxNsu: bigint | null;
  documents: DistDocument[];
}

/** Tipos de documento que o runner sabe tratar, pelo prefixo do `schema`. */
export function schemaKind(schema: string): 'resNFe' | 'procNFe' | 'resEvento' | 'procEventoNFe' | 'other' {
  for (const kind of ['procEventoNFe', 'procNFe', 'resEvento', 'resNFe'] as const) {
    if (schema.startsWith(`${kind}_`)) return kind;
  }
  return 'other';
}

const toBigInt = (v: unknown): bigint | null => {
  const s = str(v);
  return s && /^\d{1,20}$/.test(s) ? BigInt(s) : null;
};

/**
 * Lê o `retDistDFeInt` (com ou sem o envelope SOAP) e descomprime cada `docZip` (gzip em base64).
 * Falha de um documento não derruba o lote: ele vem com `error` e o runner decide (normalmente `IGNORED`).
 */
export function parseDistResponse(xml: string): DistResult {
  const root = parseXml(xml);
  const ret = find(root, 'retDistDFeInt');
  if (!ret) throw new XmlError('Resposta sem retDistDFeInt');

  const cStat = Number(str(ret.cStat));
  if (!Number.isInteger(cStat)) throw new XmlError('Resposta sem cStat');

  const zips: unknown[] = ret.loteDistDFeInt?.docZip ?? [];
  const documents = zips.map((z): DistDocument => {
    const node = z as Record<string, unknown>;
    const schema = str(node['@_schema']) ?? '';
    const nsu = toBigInt(node['@_NSU']);
    try {
      const gz = Buffer.from(str(node['#text']) ?? '', 'base64');
      if (gz.length === 0) throw new XmlError('docZip vazio');
      // maxOutputLength interrompe a descompressão no teto (zip bomb).
      const out = gunzipSync(gz, { maxOutputLength: MAX_XML_BYTES }).toString('utf8');
      return { nsu, schema, xml: out };
    } catch (err) {
      return { nsu, schema, xml: '', error: err instanceof XmlError ? err.message : 'docZip inválido ou grande demais' };
    }
  });

  return {
    tpAmb: str(ret.tpAmb) ? Number(ret.tpAmb) : null,
    cStat,
    xMotivo: str(ret.xMotivo) ?? '',
    ultNsu: toBigInt(ret.ultNSU),
    maxNsu: toBigInt(ret.maxNSU),
    documents,
  };
}

/** Procura a tag em qualquer profundidade (o envelope SOAP e os wrappers do .NET variam). */
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
