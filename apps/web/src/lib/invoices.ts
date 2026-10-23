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
  /** `catalogSku` nulo = peça só da oficina (o catálogo da plataforma ainda não a tem vinculada). */
  part: { id: string; sku: string; name: string; stockQty: string; catalogSku: string | null } | null;
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

// ---------- Triagem (tela /notas) ----------

/** Etapas do funil, na ordem em que uma nota percorre: chegou só o resumo → conciliar → pronta → lançada. */
export const STAGES = ['summary', 'pending', 'ready', 'posted'] as const satisfies readonly View[];
export const SIDE_VIEWS = ['canceled', 'ignored', 'all'] as const satisfies readonly View[];

export const STAGE_HINT: Record<(typeof STAGES)[number], string> = {
  summary: 'Falta dar ciência para a SEFAZ liberar o XML',
  pending: 'Itens ainda sem peça vinculada',
  ready: 'Tudo vinculado, falta lançar no estoque',
  posted: 'Já entraram no estoque',
};

export type NextAction = 'manifest' | 'confirm' | 'reconcile' | 'review' | null;

/** O que falta fazer na nota, em uma palavra de ação. Alimenta o botão principal e as ações em lote. */
export function nextAction(inv: Pick<InvoiceRow, 'status' | 'exportStatus' | 'needsReview'>): NextAction {
  if (inv.status === 'SUMMARY') return 'manifest';
  if (inv.status !== 'FULL') return null;
  if (inv.exportStatus === 'READY') return inv.needsReview ? 'review' : 'confirm';
  if (inv.exportStatus === 'PENDING_MATCH') return 'reconcile';
  return null;
}

/** Fração dos itens já resolvidos (0–1); null quando a nota ainda não tem itens (sem XML). */
export function resolvedRatio(inv: Pick<InvoiceRow, 'status' | 'itemCount' | 'unresolvedCount'>): number | null {
  if (inv.status !== 'FULL' || inv.itemCount === 0) return null;
  return (inv.itemCount - inv.unresolvedCount) / inv.itemCount;
}

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'LTDA', 'ME', 'EPP', 'SA', 'S/A'].includes(w.toUpperCase()));
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

/** Matiz estável (0–359) por fornecedor, para o avatar ser reconhecível de relance sem depender de logo. */
export function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

const dayKey = (iso: string, tz = 'America/Sao_Paulo') => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });

/** Rótulo do dia: "Hoje", "Ontem", dia da semana nos últimos 6 dias, senão a data por extenso. */
export function dayLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'Sem data';
  const today = dayKey(now.toISOString());
  const key = dayKey(iso);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  const d = new Date(iso);
  if (diff > 1 && diff < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: diff > 300 || diff < 0 ? 'numeric' : undefined, timeZone: 'America/Sao_Paulo' });
}

/** Agrupa mantendo a ordem da API (já vem do mais recente para o mais antigo). */
export function groupByDay<T extends { issuedAt: string | null }>(rows: readonly T[], now = new Date()): { key: string; label: string; rows: T[] }[] {
  const out: { key: string; label: string; rows: T[] }[] = [];
  for (const r of rows) {
    const key = r.issuedAt ? dayKey(r.issuedAt) : 'none';
    const last = out[out.length - 1];
    if (last?.key === key) last.rows.push(r);
    else out.push({ key, label: dayLabel(r.issuedAt, now), rows: [r] });
  }
  return out;
}

export const sumTotals = (rows: readonly Pick<InvoiceRow, 'totalAmount'>[]) => rows.reduce((s, r) => s + Number(r.totalAmount), 0);

export type Listing = { total: number; items: InvoiceRow[] };
