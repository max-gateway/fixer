// Contas a pagar. Decimais do Prisma chegam como string; vencimento é data civil (DATE), sem fuso.
import type { Tone } from './invoices';

export { formatCnpj, money } from './invoices';

export type PayableStatus = 'OPEN' | 'PAID' | 'CANCELED';
export type PayableSource = 'XML_INSTALLMENT' | 'XML_TOTAL' | 'MANUAL';

export const VIEWS = ['open', 'overdue', 'week', 'paid', 'canceled', 'all'] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  open: 'Em aberto',
  overdue: 'Vencidas',
  week: 'Próximos 7 dias',
  paid: 'Pagas',
  canceled: 'Canceladas',
  all: 'Todas',
};

export const PAYMENT_METHODS = ['PIX', 'BOLETO', 'TED', 'DINHEIRO', 'CARTAO', 'DEBITO_AUTOMATICO', 'OUTRO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const METHOD_LABEL: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  TED: 'TED / transferência',
  DINHEIRO: 'Dinheiro',
  CARTAO: 'Cartão',
  DEBITO_AUTOMATICO: 'Débito automático',
  OUTRO: 'Outro',
};

export type PayableRow = {
  id: string;
  source: PayableSource;
  supplierName: string;
  supplierCnpj: string | null;
  description: string | null;
  category: string | null;
  barcode: string | null;
  documentNumber: string | null;
  installment: number;
  installmentCount: number;
  dueDate: string;
  amount: string;
  status: PayableStatus;
  paidAt: string | null;
  paidAmount: string | null;
  interest: string | null;
  discount: string | null;
  paymentMethod: string | null;
  notes: string | null;
  invoice: { id: string; number: number | null; series: number | null; accessKey: string } | null;
};

export type PayableEvent = {
  id: string;
  type: 'CREATED' | 'EDITED' | 'PAID' | 'UNPAID' | 'CANCELED';
  actorName: string | null;
  createdAt: string;
  data: Record<string, unknown> | null;
};

export type PayableDetail = Omit<PayableRow, 'invoice'> & {
  createdAt: string;
  invoice: (NonNullable<PayableRow['invoice']> & { issuedAt: string | null; totalAmount: string }) | null;
  events: PayableEvent[];
  siblings: { id: string; installment: number; dueDate: string; amount: string; status: PayableStatus }[];
};

export type Listing = { total: number; totalAmount: string; items: PayableRow[] };

export type Summary = {
  views: Record<View, { count: number; amount: string }>;
  paidMonth: { count: number; amount: string };
  nextDue: string | null;
  today: string;
};

export type ForecastBucket = { key: string; kind: 'overdue' | 'week' | 'later'; from: string | null; to: string | null; count: number; amount: string };
export type Forecast = { today: string; buckets: ForecastBucket[] };

export type Supplier = { name: string; cnpj: string | null; openCount: number; openAmount: string; nextDue: string | null };

export type BoletoInfo =
  | { ok: true; kind: 'bank' | 'utility'; digits: string; amount: string | null; dueDate: string | null; bankCode: string | null }
  | { ok: false; reason: 'LENGTH' | 'CHECK_DIGIT' };

export type ImportResult = {
  dryRun: boolean;
  invoices: number;
  withoutBilling: number;
  unreadable: number;
  installments: number;
  alreadyExisting: number;
  open: { count: number; amount: string };
  settled: { count: number; amount: string };
};

export type Sort = 'due' | 'amount' | 'supplier' | 'paid';
export type GroupBy = 'due' | 'supplier' | 'none';

export type Filters = {
  view: View;
  q: string;
  supplier: string;
  category: string;
  source: '' | 'nfe' | 'manual';
  from: string;
  to: string;
  sort: Sort;
  dir: 'asc' | 'desc';
  group: GroupBy;
};

export const DEFAULT_FILTERS: Filters = { view: 'open', q: '', supplier: '', category: '', source: '', from: '', to: '', sort: 'due', dir: 'asc', group: 'due' };

const SORTS: Sort[] = ['due', 'amount', 'supplier', 'paid'];
const GROUPS: GroupBy[] = ['due', 'supplier', 'none'];

/** Lê os filtros de uma URL (ou dos searchParams do servidor), ignorando valores fora do esperado. */
export function filtersFromParams(get: (k: string) => string | null | undefined): Filters {
  const pick = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
    const v = get(k);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  const date = (k: string) => {
    const v = get(k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  };
  return {
    view: pick('view', VIEWS, 'open'),
    q: (get('q') ?? '').slice(0, 100),
    supplier: (get('supplier') ?? '').slice(0, 200),
    category: (get('category') ?? '').slice(0, 60),
    source: pick('source', ['', 'nfe', 'manual'] as const, ''),
    from: date('from'),
    to: date('to'),
    sort: pick('sort', SORTS, 'due'),
    dir: pick('dir', ['asc', 'desc'] as const, 'asc'),
    group: pick('group', GROUPS, 'due'),
  };
}

/** Filtros → query string. `forApi` inclui paginação/ordenação que a API entende; sem ele, só o que vai para a URL da tela. */
export function filtersToParams(f: Filters, opts: { forApi?: boolean } = {}): URLSearchParams {
  const p = new URLSearchParams();
  const d = DEFAULT_FILTERS;
  if (f.view !== d.view || opts.forApi) p.set('view', f.view);
  for (const k of ['q', 'supplier', 'category', 'source', 'from', 'to'] as const) if (f[k]) p.set(k, f[k]);
  if (f.sort !== d.sort) p.set('sort', f.sort);
  if (f.dir !== d.dir) p.set('dir', f.dir);
  if (!opts.forApi && f.group !== d.group) p.set('group', f.group);
  return p;
}

export const activeFilterCount = (f: Filters) => [f.supplier, f.category, f.source, f.from || f.to].filter(Boolean).length;

/** Data civil do banco (meia-noite UTC) como dd/mm/aaaa, sem deslocar o dia pelo fuso. */
export const civilDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '—';

export const civilShort = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '');

export const civilWeekday = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');

export const isoDay = (iso: string) => iso.slice(0, 10);

/** Hoje (data civil de Brasília) como AAAA-MM-DD. */
export const todayIso = (now: Date = new Date()) => now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Dias até o vencimento (negativo = atrasada), comparando datas civis. */
export function daysUntil(dueIso: string, today: string): number {
  return Math.round((Date.parse(`${isoDay(dueIso)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function relativeDue(dueIso: string, today: string): string {
  const d = daysUntil(dueIso, today);
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  if (d === -1) return 'ontem';
  if (d < 0) return `há ${-d} dias`;
  return `em ${d} dias`;
}

export function describePayable(p: Pick<PayableRow, 'status' | 'dueDate'>, today: string): { label: string; tone: Tone } {
  if (p.status === 'PAID') return { label: 'Paga', tone: 'success' };
  if (p.status === 'CANCELED') return { label: 'Cancelada', tone: 'secondary' };
  const d = daysUntil(p.dueDate, today);
  if (d < 0) return { label: d === -1 ? 'Venceu ontem' : `Atrasada ${-d} dias`, tone: 'danger' };
  if (d === 0) return { label: 'Vence hoje', tone: 'warning' };
  if (d <= 7) return { label: d === 1 ? 'Vence amanhã' : `Vence em ${d} dias`, tone: 'warning' };
  return { label: 'A vencer', tone: 'outline' };
}

// ---------- agrupamento ----------

export type Group = { key: string; label: string; hint?: string; tone: 'danger' | 'warning' | 'neutral'; rows: PayableRow[]; amount: string };

const cents = (v: string) => {
  const [i = '0', f = ''] = v.split('.');
  return BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2));
};
export const sumAmounts = (rows: { amount: string }[]): string => {
  const c = rows.reduce((s, r) => s + cents(r.amount), 0n);
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
};

function dueBucket(row: PayableRow, today: string): { key: string; label: string; tone: Group['tone'] } {
  if (row.status !== 'OPEN') {
    const month = isoDay(row.paidAt ?? row.dueDate).slice(0, 7);
    return { key: `m-${month}`, label: new Date(`${month}-01T00:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }), tone: 'neutral' };
  }
  const d = daysUntil(row.dueDate, today);
  if (d < 0) return { key: 'overdue', label: 'Vencidas', tone: 'danger' };
  if (d === 0) return { key: 'today', label: 'Hoje', tone: 'warning' };
  if (d === 1) return { key: 'tomorrow', label: 'Amanhã', tone: 'warning' };
  if (d <= 7) return { key: 'week', label: 'Próximos 7 dias', tone: 'neutral' };
  if (d <= 30) return { key: 'month', label: 'Próximos 30 dias', tone: 'neutral' };
  return { key: 'later', label: 'Mais adiante', tone: 'neutral' };
}

/** Agrupa mantendo a ordem em que as linhas chegaram (a API já ordenou). */
export function groupRows(rows: PayableRow[], by: GroupBy, today: string): Group[] {
  if (by === 'none') return rows.length ? [{ key: 'all', label: 'Todas', tone: 'neutral', rows, amount: sumAmounts(rows) }] : [];
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const g =
      by === 'supplier'
        ? { key: `s-${r.supplierCnpj ?? r.supplierName.toLowerCase()}`, label: r.supplierName || 'Fornecedor não identificado', tone: 'neutral' as const }
        : dueBucket(r, today);
    const cur = groups.get(g.key) ?? { ...g, rows: [], amount: '0.00' };
    cur.rows.push(r);
    groups.set(g.key, cur);
  }
  return [...groups.values()].map((g) => ({ ...g, amount: sumAmounts(g.rows) }));
}

/** Iniciais para o avatar do fornecedor (ignora "LTDA", "SA", "ME"...). */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(ltda|sa|s\/a|me|epp|eireli|de|da|do|e)$/i.test(w));
  const [a, b] = words;
  return ((a?.[0] ?? '?') + (b?.[0] ?? '')).toUpperCase();
}

/** Total a pagar já com juros e desconto, em centavos exatos (para a pré-visualização do pagamento). */
export function payTotal(amount: string, interest: number, discount: number): number {
  return Math.round((Number(amount) + interest - discount) * 100) / 100;
}

/** "1.234,56" / "1234,56" / "1234.56" → 1234.56; vazio ou inválido → null. */
export function parseMoneyInput(v: string): number | null {
  const s = v.trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
