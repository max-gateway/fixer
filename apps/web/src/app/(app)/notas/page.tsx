import { TriangleAlert } from 'lucide-react';
import { ApiError, apiGet } from '@/lib/api';
import type { FiscalStatus } from '@/lib/fiscal-import';
import { VIEWS, type Listing, type View } from '@/lib/invoices';
import { InvoicesWorkspace } from './invoices-workspace';

export const metadata = { title: 'Notas de compra' };

export default async function NotasPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as View) : 'pending';
  const q = sp.q?.trim() || '';

  try {
    const params = new URLSearchParams({ view, take: '50' });
    if (q) params.set('q', q);
    const [listing, counts, status] = await Promise.all([
      apiGet<Listing>(`/invoices?${params}`),
      apiGet<Record<View, number>>('/invoices/summary'),
      apiGet<FiscalStatus>('/fiscal/status').catch(() => null),
    ]);
    return <InvoicesWorkspace initial={{ view, q, listing, counts, status }} />;
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Notas de compra</h1>
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">{denied ? 'Você não tem permissão para ver as notas de compra.' : 'Não foi possível carregar as notas.'}</p>
            <p>{denied ? 'Peça a um administrador a permissão "invoices.read".' : 'Verifique sua conexão e recarregue a página.'}</p>
          </div>
        </div>
      </section>
    );
  }
}
