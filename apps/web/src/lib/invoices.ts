// Notas de compra (NF-e) recebidas da SEFAZ. Decimais do Prisma chegam como string no JSON.

export type InvoiceStatus = 'SUMMARY' | 'MANIFESTED' | 'FULL' | 'CANCELED' | 'IGNORED';
export type ExportStatus = 'NOT_READY' | 'PENDING_MATCH' | 'READY' | 'POSTED' | 'VOIDED';
export type ItemResolution = 'UNRESOLVED' | 'AUTO_MAP' | 'AUTO_EAN' | 'MANUAL' | 'IGNORED';

export const VIEWS = ['pending', 'ready', 'posted', 'summary', 'canceled', 'ignored', 'all'] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  pending: 'Para conciliar',
  ready: 'Prontas',
  posted: 'Lançadas',
  summary: 'Sem XML',
  canceled: 'Canceladas',
  ignored: 'Ignoradas',
  all: 'Todas',
};

export type InvoiceRow = {
  id: string;
  accessKey: string;
  number: number | null;
  series: number | null;
  issuedAt: string | null;
  issuerName: string;
  issuerCnpj: string;
  totalAmount: string;
  status: InvoiceStatus;
  exportStatus: ExportStatus;
  needsReview: boolean;
  manifestError: string | null;
  itemCount: number;
  unresolvedCount: number;
};

export type InvoiceItem = {
  id: string;
  itemNumber: number;
  supplierCode: string;
  ean: string | null;
  description: string;
  ncm: string;
  cest: string | null;
  cfop: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  resolution: ItemResolution;
  unitFactor: string;
  partId: string | null;
  part: { id: string; sku: string; name: string; stockQty: string } | null;
};

export type InvoiceDetail = Omit<InvoiceRow, 'itemCount' | 'unresolvedCount'> & {
  finality: number | null;
  recipientCnpj: string | null;
  ignoredReason: string | null;
  manifestAttempts: number;
  hasXml: boolean;
  postedAt: string | null;
  canceledAt: string | null;
  items: InvoiceItem[];
};

export type Tone = 'success' | 'warning' | 'danger' | 'secondary' | 'outline';

/** Uma situação só, legível, a partir dos dois eixos de estado (fiscal e de estoque). */
export function describeInvoice(inv: Pick<InvoiceRow, 'status' | 'exportStatus' | 'needsReview'>): { label: string; tone: Tone } {
  if (inv.status === 'CANCELED') return { label: 'Cancelada', tone: 'danger' };
  if (inv.status === 'IGNORED') return { label: 'Ignorada', tone: 'secondary' };
  if (inv.status === 'SUMMARY') return { label: 'Aguardando ciência', tone: 'warning' };
  if (inv.status === 'MANIFESTED') return { label: 'Aguardando XML', tone: 'warning' };
  switch (inv.exportStatus) {
    case 'POSTED':
      return { label: 'Lançada', tone: 'success' };
    case 'VOIDED':
      return { label: 'Estornada', tone: 'secondary' };
    case 'READY':
      return { label: 'Pronta para lançar', tone: 'success' };
    default:
      return { label: inv.needsReview ? 'Revisar' : 'Conciliar itens', tone: 'warning' };
  }
}

export const IGNORED_REASON: Record<string, string> = {
  NOT_RECIPIENT: 'A nota não é para o CNPJ da oficina (a empresa aparece como emitente, transportadora ou terceiro).',
  ISSUED_BY_TENANT: 'Nota emitida pela própria oficina.',
  NOT_INBOUND: 'Nota de entrada própria, não é uma compra.',
  NOT_AUTHORIZED: 'A nota não está autorizada (denegada ou com protocolo inválido).',
  NO_ITEMS: 'A nota não tem itens.',
  KEY_MISMATCH: 'A chave de acesso não confere com o emitente.',
  INVALID_ITEMS: 'Os itens da nota estão fora do formato esperado.',
  CANCELED_OR_DENIED: 'A SEFAZ informou que a nota foi cancelada ou denegada.',
  MANIFEST_DEADLINE: 'O prazo para dar ciência da operação já passou.',
};

export const FINALITY_LABEL: Record<number, string> = { 1: 'Normal', 2: 'Complementar', 3: 'Ajuste', 4: 'Devolução' };

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v: string | number) => brl.format(Number(v));

/** Quantidade sem zeros à direita desnecessários (2.0000 → 2; 1.5000 → 1,5). */
export const qty = (v: string | number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : '—';

/** CNPJ (numérico ou alfanumérico) com máscara; CPF de produtor rural e valores estranhos passam como vieram. */
export function formatCnpj(v: string): string {
  if (v.length === 14) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  if (v.length === 11) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  return v;
}

/** Chave de acesso em grupos de 4, como no DANFE. */
export const formatKey = (k: string) => k.replace(/(.{4})/g, '$1 ').trim();
