import type { OrderStatus } from './orders';

export type EventType = 'MESSAGE' | 'PROBLEM_REPORT' | 'STATUS_CHANGE' | 'CHECKLIST_UPDATE' | 'CUSTOMER_DATA_UPDATE' | 'WHATSAPP_LINK';
export type EventAuthor = 'CUSTOMER' | 'SHOP' | 'SYSTEM';
export type ChecklistStatus = 'PENDING' | 'OK' | 'ISSUE';

export type OrderEvent = {
  id: string;
  type: EventType;
  author: EventAuthor;
  authorName: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  /** Só no cliente: mensagem ainda não confirmada pela API. */
  pending?: boolean;
  failed?: boolean;
};

export type ChecklistItem = {
  id: string;
  section: string;
  label: string;
  status: ChecklistStatus;
  note: string | null;
};

export type PortalCustomer = {
  name: string;
  /** Mascarado (só os 2 últimos dígitos); null enquanto o cadastro está pendente. */
  document: string | null;
  phone: string | null;
  email: string | null;
  zipCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
};

export type PortalOrder = {
  number: number;
  status: OrderStatus;
  createdAt: string;
  readOnly: boolean;
  description: string | null;
  mileageAtEntry: number | null;
  vehicle: { plate: string; brand: string; model: string; year: number | null; color: string | null };
  /** OS aberta só com o telefone: o cliente ainda precisa informar CPF/CNPJ e seus dados. */
  registrationPending: boolean;
  customer: PortalCustomer;
  services: { id: string; name: string; price: string }[];
  parts: { id: string; name: string; quantity: string; unitPrice: string }[];
  total: number;
  checklist: ChecklistItem[];
  events: OrderEvent[];
  /** `url` (wa.me com o código) só vem enquanto há o que vincular; null se a oficina não configurou o número. */
  whatsapp: { linked: boolean; phoneLast4: string | null; url: string | null };
};

export const SYMPTOM_LABEL: Record<string, string> = {
  NOISE: 'Barulho estranho',
  LEAK: 'Vazamento',
  WARNING_LIGHT: 'Luz no painel',
  VIBRATION: 'Vibração',
  BRAKES: 'Freios',
  WONT_START: 'Não liga',
  OVERHEATING: 'Superaquecimento',
  SMOKE_SMELL: 'Fumaça ou cheiro',
};

export const WHEN_LABEL: Record<string, string> = {
  ALWAYS: 'O tempo todo',
  BRAKING: 'Ao frear',
  ACCELERATING: 'Ao acelerar',
  COLD_START: 'Com o carro frio',
  WHEN_HOT: 'Com o carro quente',
  SOMETIMES: 'De vez em quando',
};

/** Campos que contam para a "ficha completa" do cliente. */
export const CUSTOMER_REQUIRED: (keyof PortalCustomer)[] = ['phone', 'email', 'zipCode', 'street', 'number', 'district', 'city', 'state'];

export function customerCompleteness(c: PortalCustomer): number {
  const filled = CUSTOMER_REQUIRED.filter((k) => Boolean(c[k])).length;
  return Math.round((filled / CUSTOMER_REQUIRED.length) * 100);
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', ...(diff > 300 ? { year: 'numeric' } : {}) });
}

export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
