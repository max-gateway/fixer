import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { STATUS_LABEL, type OrderStatus, type OrderSummary } from '@/lib/orders';

export default async function OrdensPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const params = new URLSearchParams();
  if (q) params.set('search', q);
  if (status) params.set('status', status);

  let orders: OrderSummary[] = [];
  let error: string | null = null;
  try {
    orders = await apiGet<OrderSummary[]>(`/service-orders?${params}`);
  } catch {
    error = 'Não foi possível carregar as ordens.';
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ordens de serviço</h1>
        <Link href="/ordens/nova" className="rounded bg-brand px-4 py-2 transition hover:bg-brand-hover font-medium text-white">
          Nova ordem
        </Link>
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Número, placa ou cliente"
          aria-label="Buscar"
          className="w-72 rounded border border-slate-300 px-3 py-2"
        />
        <select
          name="status"
          defaultValue={status ?? ''}
          aria-label="Status"
          className="rounded border border-slate-300 px-3 py-2"
        >
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button className="rounded border border-slate-300 px-4 py-2">Filtrar</button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!error && orders.length === 0 && <p className="text-slate-600">Nenhuma ordem encontrada.</p>}

      {orders.length > 0 && (
        <table className="w-full overflow-hidden rounded border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-4 py-2">Nº</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Veículo</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Abertura</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/ordens/${o.id}`} className="text-brand underline">
                    #{o.number}
                  </Link>
                </td>
                <td className="px-4 py-2">{o.customer.name}</td>
                <td className="px-4 py-2">
                  {o.vehicle.plate} · {o.vehicle.brand} {o.vehicle.model}
                </td>
                <td className="px-4 py-2">{STATUS_LABEL[o.status]}</td>
                <td className="px-4 py-2">{new Date(o.createdAt).toLocaleDateString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
