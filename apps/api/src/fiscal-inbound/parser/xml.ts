import { XMLParser } from 'fast-xml-parser';

/** Documento de entrada rejeitado antes de virar dado (DTD, tamanho, XML malformado). */
export class XmlError extends Error {}

/** Teto de uma NF-e/evento descomprimido. O tamanho médio é ~10 KB; 5 MB cobre notas enormes e barra zip bomb. */
export const MAX_XML_BYTES = 5 * 1024 * 1024;

// Tudo como string: CNPJ, chave de acesso e NSU nunca podem passar por Number (CNPJ alfanumérico, zeros à esquerda).
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  isArray: (name) => name === 'det' || name === 'docZip' || name === 'dup' || name === 'detPag',
});

/**
 * Faz o parse recusando DTD e entidades (XXE, billion laughs): documentos fiscais legítimos não usam
 * nenhum dos dois. O tamanho é limitado pelo chamador, mas conferido aqui também.
 */
export function parseXml(xml: string): Record<string, any> {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) throw new XmlError('XML grande demais');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new XmlError('XML com DTD/entidade não é aceito');
  try {
    return parser.parse(xml) as Record<string, any>;
  } catch {
    throw new XmlError('XML malformado');
  }
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
