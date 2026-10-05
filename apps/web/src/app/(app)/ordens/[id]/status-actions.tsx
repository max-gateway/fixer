'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';

export function StatusActions({ orderId, nextStatuses }: { orderId: string; nextStatuses: OrderStatus[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (nextStatuses.length === 0) return null;

  async function change(status: OrderStatus) {
    if (status === 'CANCELLED' && !confirm('Cancelar esta ordem?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-orders/${orderId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? 'Falha ao mudar o status.');
        return;
      }
      router.refresh();
    } catch {
      setError('Falha de rede.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {nextStatuses.map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => change(s)}
            className={
              s === 'CANCELLED'
                ? 'rounded border border-red-300 px-4 py-2 text-red-700 disabled:opacity-60'
                : 'rounded bg-brand px-4 py-2 transition hover:bg-brand-hover font-medium text-white disabled:opacity-60'
            }
          >
            {STATUS_LABEL[s]}
          </button>
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
