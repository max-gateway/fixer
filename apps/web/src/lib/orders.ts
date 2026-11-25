export type OrderStatus =
  | 'QUOTE'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'AWAITING_PART'
  | 'COMPLETED'
  | 'DELIVERED'
  | 'CANCELLED';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  QUOTE: 'Orçamento',
  APPROVED: 'Aprovada',
  IN_PROGRESS: 'Em andamento',
  AWAITING_PART: 'Aguardando peça',
  COMPLETED: 'Concluída',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelada',
};

// Decimais do Prisma chegam como string no JSON.
export type Part = { id: string; sku: string; name: string; sellPrice: string; stockQty: string };
export type Service = { id: string; name: string; defaultPrice: string };

export type OrderSummary = {
  id: string;
  number: number;
  status: OrderStatus;
  createdAt: string;
  customer: { id: string; name: string };
  vehicle: { id: string; plate: string; brand: string; model: string };
};

export type OrderDetail = Omit<OrderSummary, 'customer'> & OrderPortalData & {
  customer: { id: string; name: string; document: string | null; phone: string | null };
  description: string | null;
  mileageAtEntry: number | null;
  nextStatuses: OrderStatus[];
  partLines: { id: string; partName: string; quantity: string; unitPrice: string }[];
  serviceLines: {
    id: string;
    serviceName: string;
    price: string;
    description: string | null;
    hoursEstimated: string | null;
    hoursEstimateSource: EstimateSource | null;
    hoursActual: string | null;
  }[];
  statusLogs: {
    id: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    note: string | null;
    createdAt: string;
    changedBy: { name: string };
  }[];
};

import type { ChecklistItem, OrderEvent } from './portal';
import type { EstimateSource } from './service-hours';

export type OrderPortalData = {
  portalToken: string;
  /** Código OS-XXXX-XXXX que o cliente envia pelo WhatsApp para vincular o número à ordem. */
  linkCode: string;
  whatsappLinkedAt: string | null;
  whatsappLinkedPhone: string | null;
  checklist: ChecklistItem[];
  events: OrderEvent[];
};

export const brl = (value: string | number) =>
  Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Espelha status.ts da API: DELIVERED e CANCELLED não aceitam mais interação. */
export const isTerminal = (status: OrderStatus) => status === 'DELIVERED' || status === 'CANCELLED';

/** Cor semântica fixa por status (igual em todos os tenants). `dot` marca a bolinha; `chip` o fundo/texto do selo. */
export const STATUS_STYLE: Record<OrderStatus, { dot: string; chip: string }> = {
  QUOTE: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700' },
  APPROVED: { dot: 'bg-sky-500', chip: 'bg-sky-100 text-sky-900' },
  IN_PROGRESS: { dot: 'bg-brand', chip: 'bg-brand-soft text-brand' },
  AWAITING_PART: { dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-900' },
  COMPLETED: { dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800' },
  DELIVERED: { dot: 'bg-emerald-700', chip: 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 ring-inset' },
  CANCELLED: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-800' },
};

/** "há 3 h", "ontem", "12/08". Cai para data curta depois de uma semana. */
export function relativeDate(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}
