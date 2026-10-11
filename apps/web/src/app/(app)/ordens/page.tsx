import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { OrderFilters } from '@/components/orders/order-filters';
import { buttonVariants } from '@/components/ui/button';
import { OrdersList, OrdersListSkeleton } from './orders-list';

export const metadata = { title: 'Ordens de serviço' };

export default async function OrdensPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status } = await searchParams;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ordens de serviço</h1>
          <p className="text-sm text-muted-foreground">Acompanhe o que está na oficina e o que espera por você.</p>
        </div>
        <Link href="/ordens/nova" className={buttonVariants({ size: 'lg' })}>
          <Plus aria-hidden /> Nova ordem
        </Link>
      </header>

      <Suspense>
        <OrderFilters />
      </Suspense>

      {/* key faz o esqueleto reaparecer quando a busca muda */}
      <Suspense key={`${q ?? ''}|${status ?? ''}`} fallback={<OrdersListSkeleton />}>
        <OrdersList q={q} status={status} />
      </Suspense>
    </section>
  );
}
