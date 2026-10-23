'use client';

import { Bell, Globe, Mail, MessageCircle, RefreshCw, RotateCcw, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, type badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  EVENT_LABEL,
  fetchDeliveries,
  retryDelivery,
  timeAgo,
  type Delivery,
  type DeliveryStatus,
} from '@/lib/notifications';
import type { VariantProps } from 'class-variance-authority';

const CHANNEL: Record<Delivery['channel'], { icon: LucideIcon; label: string }> = {
  email: { icon: Mail, label: 'E-mail' },
  webhook: { icon: Globe, label: 'Webhook' },
  whatsapp: { icon: MessageCircle, label: 'WhatsApp' },
};
/** Canal que a UI ainda não conhece (o serviço de notificações ganha canais antes do front): nunca quebra a tela. */
const UNKNOWN_CHANNEL = { icon: Bell, label: 'Notificação' };

const STATUS: Record<DeliveryStatus, { label: string; variant: VariantProps<typeof badgeVariants>['variant'] }> = {
  SENT: { label: 'Enviada', variant: 'success' },
  PENDING: { label: 'Na fila', variant: 'warning' },
  SENDING: { label: 'Enviando', variant: 'warning' },
  DEAD: { label: 'Falhou', variant: 'danger' },
  SUPPRESSED: { label: 'Bloqueada', variant: 'secondary' },
};

const POLL_MS = 8_000;

/** Auditoria de entregas da ordem: quem foi avisado, por qual canal e com que resultado. Reenvio das que falharam. */
export function OrderDeliveries({ orderId }: { orderId: string }) {
  const reduce = useReducedMotion();
  const [items, setItems] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(
    async (manual = false) => {
      ctl.current?.abort();
      const c = (ctl.current = new AbortController());
      if (manual) setRefreshing(true);
      try {
        const r = await fetchDeliveries(orderId, c.signal);
        setItems(r.items);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [orderId],
  );

  useEffect(() => {
    void load();
    return () => ctl.current?.abort();
  }, [load]);

  // Enquanto houver algo na fila, acompanha (a entrega costuma sair em segundos).
  const hasPending = items?.some((d) => d.status === 'PENDING' || d.status === 'SENDING') ?? false;
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [hasPending, load]);

  async function retry(id: string) {
    setRetrying((s) => new Set(s).add(id));
    try {
      await retryDelivery(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-card p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Notificações enviadas</h2>
        <Button size="xs" variant="ghost" onClick={() => void load(true)} disabled={refreshing} aria-label="Atualizar">
          <RefreshCw className={refreshing ? 'animate-spin' : ''} /> Atualizar
        </Button>
      </div>

      {items === null && !error && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}

      {items?.length === 0 && <p className="text-slate-600">Nenhuma notificação enviada para esta ordem ainda.</p>}

      {items && items.length > 0 && (
        <ul className="divide-y divide-slate-200">
          <AnimatePresence initial={false}>
            {items.map((d) => {
              const ch = CHANNEL[d.channel] ?? UNKNOWN_CHANNEL;
              const st = STATUS[d.status];
              return (
                <motion.li
                  key={d.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3 py-2.5"
                >
                  <ch.icon className="mt-0.5 size-4 shrink-0 text-slate-500" aria-label={ch.label} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.subject ?? EVENT_LABEL[d.eventType] ?? d.eventType}</p>
                    <p className="truncate text-slate-600">
                      {d.recipient}
                      <span aria-hidden> · </span>
                      <time dateTime={d.createdAt}>{timeAgo(d.createdAt)}</time>
                    </p>
                    {d.status === 'PENDING' && d.attempts > 0 && (
                      <p className="text-xs text-amber-800">
                        Tentativa {d.attempts}/{d.maxAttempts} falhou
                        {d.nextAttemptAt && <> — nova tentativa {timeAgo(d.nextAttemptAt)}</>}
                      </p>
                    )}
                    {d.status === 'DEAD' && d.lastError && <p className="text-xs break-words text-red-700">{d.lastError}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {d.status === 'DEAD' && (
                      <Button size="xs" variant="outline" disabled={retrying.has(d.id)} onClick={() => void retry(d.id)}>
                        <RotateCcw /> Reenviar
                      </Button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
