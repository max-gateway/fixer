// Utilitários para ler o texto oficial baixado do Planalto, do Confaz e da Câmara. Sem dependências: regex sobre o HTML.

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ordm: 'º', ordf: 'ª', sect: '§', ccedil: 'ç', Ccedil: 'Ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', ndash: '–', mdash: '—', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** HTML -> texto: uma linha por bloco, células separadas por " | ", espaços colapsados dentro da linha. */
export function htmlToText(html: string): string {
  const noScript = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const blocks = noScript.replace(/<\/(tr|p|div|h\d|li|table)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ');
  const text = decodeEntities(blocks.replace(/<[^>]+>/g, ''));
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Texto numa linha só, sem barras de tabela e sem espaço duplo: para procurar sequências como "7,30% 5.940,00". */
export function flat(text: string): string {
  return text.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "5.50" -> "5,50%". */
export const pctBR = (p: string) => `${p.replace('.', ',')}%`;

/** Centavos -> "5.940,00". */
export function reaisBR(cents: bigint): string {
  const int = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${int},${(cents % 100n).toString().padStart(2, '0')}`;
}

/** Decodifica bytes de uma página: UTF-8 se válido, senão Windows-1252 (Planalto antigo). */
export function decodeBody(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
