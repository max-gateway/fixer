import { inflateRawSync } from 'node:zlib';

// Leitor mínimo de .xlsx (zip + XML) para planilhas oficiais, sem dependências: lê só a primeira planilha e os textos
// compartilhados, o bastante para a TIPI da Receita. Não serve para fórmulas, datas nem estilos.

function unzip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('xlsx inválido: sem diretório central');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx inválido: entrada do diretório central');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 0 ? raw : method === 8 ? inflateRawSync(raw) : (() => { throw new Error(`xlsx: compressão ${method} não suportada`); })());
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (XML_ENTITIES[e] ?? m)));

export type SheetRow = { row: number; cells: Record<string, string> };

/** Linhas da primeira planilha; células vazias não aparecem. */
export function readFirstSheet(xlsx: Buffer): SheetRow[] {
  const files = unzip(xlsx);
  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const sheet = files.get('xl/worksheets/sheet1.xml')?.toString('utf8');
  if (!sheet) throw new Error('xlsx: planilha 1 não encontrada');
  const rows: SheetRow[] = [];
  for (const r of sheet.matchAll(/<row [^>]*?r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: Record<string, string> = {};
    for (const c of (r[2] ?? '').matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const inner = c[3];
      if (inner === undefined) continue;
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (v) cells[c[1]!] = /t="s"/.test(c[2]!) ? (shared[Number(v[1])] ?? '') : decodeXml(v[1]!);
      else {
        const t = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
        if (t) cells[c[1]!] = decodeXml(t);
      }
    }
    rows.push({ row: Number(r[1]), cells });
  }
  return rows;
}
