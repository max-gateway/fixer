// Cliente do serviço de notificações (via proxy /api/notifications). Só roda no navegador.

export type InboxItem = {
  id: string;
  orderId: string;
  orderNumber: number | null;
  eventType: string;
  title: string;
  body: string;
  severity: 'info' | 'warning';
  createdAt: string;
  readAt: string | null;
};

export type InboxPage = { items: InboxItem[]; nextCursor: string | null; unreadCount: number };

export type DeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'DEAD' | 'SUPPRESSED';

export type Delivery = {
  id: string;
  eventType: string;
  channel: 'email' | 'webhook' | 'whatsapp';
  recipientKind: 'customer' | 'staff' | 'integration';
  recipient: string;
  subject: string | null;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

export class NotificationsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/notifications/${path}`, { cache: 'no-store', ...init });
  } catch {
    throw new NotificationsError('Falha de rede', 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // 404/502 vindos do proxy = serviço fora do ar ou porta errada; a mensagem do upstream não ajuda o usuário.
    const down = res.status === 404 || res.status === 502;
    throw new NotificationsError(down ? 'Serviço de notificações indisponível' : (body.message ?? `Erro ${res.status}`), res.status);
  }
  return res.json() as Promise<T>;
}

export const fetchInbox = (opts: { unreadOnly: boolean; cursor?: string | null; limit?: number }, signal?: AbortSignal) => {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 20), unread: String(opts.unreadOnly) });
  if (opts.cursor) q.set('cursor', opts.cursor);
  return call<InboxPage>(`inbox?${q}`, { signal });
};

export const markInboxRead = (target: { ids: string[] } | { all: true }) =>
  call<{ updated: number; unreadCount: number }>('inbox/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(target),
  });

export const fetchDeliveries = (orderId: string, signal?: AbortSignal) =>
  call<{ items: Delivery[] }>(`orders/${encodeURIComponent(orderId)}/deliveries`, { signal });

export const retryDelivery = (id: string) => call<{ status: string }>(`deliveries/${encodeURIComponent(id)}/retry`, { method: 'POST' });

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** "agora", "há 5 minutos", "ontem"... Datas > 7 dias viram data curta. */
export function timeAgo(iso: string, now = Date.now()): string {
  const sec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return 'agora';
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(sec / 86_400), 'day');
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export const EVENT_LABEL: Record<string, string> = {
  'order.created': 'Ordem aberta',
  'order.status_changed': 'Mudança de status',
  'order.message_posted': 'Mensagem',
  'order.problem_reported': 'Problema relatado',
  'order.checklist_item_added': 'Item de checklist',
  'order.checklist_item_answered': 'Checklist respondido',
  'order.customer_data_updated': 'Dados do cliente',
  'order.whatsapp_linked': 'WhatsApp conectado',
  'order.whatsapp_link_conflict': 'WhatsApp com número diferente',
};
