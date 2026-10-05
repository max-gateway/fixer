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
  serviceLines: { id: string; serviceName: string; price: string }[];
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
