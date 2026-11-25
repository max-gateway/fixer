'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { postJson } from '@/lib/client-api';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';

export function StatusActions({ orderId, nextStatuses }: { orderId: string; nextStatuses: OrderStatus[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const mutation = useMutation({
    mutationFn: (status: OrderStatus) => postJson(`/api/service-orders/${orderId}/status`, { status }, 'Falha ao mudar o status.'),
    onSuccess: () => {
      setConfirmCancel(false);
      // Atualiza o histórico do portal (cache do client) e a página (Server Components).
      void queryClient.invalidateQueries({ queryKey: ['service-order', orderId] });
      router.refresh();
    },
  });
  const busy = mutation.isPending;
  const error = mutation.error?.message ?? null;

  if (nextStatuses.length === 0) return null;

  const forward = nextStatuses.filter((s) => s !== 'CANCELLED');
  const canCancel = nextStatuses.includes('CANCELLED');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {forward.map((s, i) => (
          <Button key={s} disabled={busy} variant={i === 0 ? 'default' : 'outline'} onClick={() => mutation.mutate(s)}>
            {busy && mutation.variables === s && <Loader2 aria-hidden className="animate-spin" />}
            {STATUS_LABEL[s]}
          </Button>
        ))}
        {canCancel &&
          (confirmCancel ? (
            <span className="flex flex-wrap items-center gap-2 text-sm sm:ml-auto">
              Cancelar esta ordem?
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => mutation.mutate('CANCELLED')}>
                Sim, cancelar
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(false)}>
                Voltar
              </Button>
            </span>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)} className="text-destructive hover:bg-red-50 hover:text-destructive sm:ml-auto">
              Cancelar ordem
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
