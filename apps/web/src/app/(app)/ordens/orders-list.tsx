import { ChevronRight, FileSearch, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Plate, StatusBadge } from '@/components/orders/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';
import { relativeDate, type OrderSummary } from '@/lib/orders';

export async function OrdersList({ q, status }: { q?: string; status?: string }) {
  const params = new URLSearchParams();
  if (q) params.set('search', q);
  if (status) params.set('status', status);

  let orders: OrderSummary[];
  try {
    orders = await apiGet<OrderSummary[]>(`/service-orders?${params}`);
  } catch {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-semibold">Não foi possível carregar as ordens.</p>
          <p>Verifique sua conexão e recarregue a página.</p>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    const filtered = Boolean(q || status);
    return (
      <div className="grid place-items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <FileSearch aria-hidden className="size-6" />
        </span>
        <div>
          <p className="font-semibold">{filtered ? 'Nenhuma ordem com esses filtros' : 'Nenhuma ordem ainda'}</p>
          <p className="text-sm text-muted-foreground">
            {filtered ? 'Tente outro termo ou limpe o filtro de status.' : 'Abra a primeira ordem lendo a placa do veículo.'}
          </p>
        </div>
        {filtered ? (
          <Link href="/ordens" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Limpar filtros
          </Link>
        ) : (
          <Link href="/ordens/nova" className={buttonVariants({ size: 'sm' })}>
            Nova ordem
          </Link>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
        {orders.length} {orders.length === 1 ? 'ordem' : 'ordens'}
      </p>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/ordens/${o.id}`}
              className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 sm:grid-cols-[4.5rem_minmax(0,1.2fr)_minmax(0,1.4fr)_auto_5rem_1rem] sm:py-3"
            >
              <span className="tabular text-sm font-semibold text-brand">#{o.number}</span>
              <StatusBadge status={o.status} className="col-start-2 row-start-1 justify-self-end sm:col-start-4" />
              <span className="col-span-2 min-w-0 sm:order-none sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <span className="block truncate text-sm font-medium">{o.customer.name}</span>
              </span>
              <span className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                <Plate value={o.vehicle.plate} />
                <span className="truncate text-sm text-muted-foreground">
                  {o.vehicle.brand} {o.vehicle.model}
                </span>
              </span>
              <time dateTime={o.createdAt} title={new Date(o.createdAt).toLocaleString('pt-BR')} className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:col-start-5 sm:row-start-1 sm:text-right">
                {relativeDate(o.createdAt)}
              </time>
              <ChevronRight aria-hidden className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrdersListSkeleton() {
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card" aria-busy aria-label="Carregando ordens">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-6 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}
