import { brl } from '@/lib/orders';
import type { PortalOrder } from '@/lib/portal';

export function SummaryPanel({ order }: { order: PortalOrder }) {
  const empty = order.services.length + order.parts.length === 0;
  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-card surface p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">Serviços e peças</h2>
        {empty ? (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            A oficina ainda está montando o orçamento. Você será avisado aqui na conversa assim que estiver pronto.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {order.services.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-4 py-3">
                <div>
                  <p className="text-[15px]">{s.name}</p>
                  <p className="text-xs text-slate-500">Mão de obra</p>
                </div>
                <span className="tabular-nums">{brl(s.price)}</span>
              </li>
            ))}
            {order.parts.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                <div>
                  <p className="text-[15px]">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {Number(p.quantity)} × {brl(p.unitPrice)}
                  </p>
                </div>
                <span className="tabular-nums">{brl(Number(p.quantity) * Number(p.unitPrice))}</span>
              </li>
            ))}
          </ul>
        )}
        {!empty && (
          <div className="mt-2 flex items-baseline justify-between border-t border-slate-200 pt-4">
            <span className="text-sm font-medium text-slate-600">Total</span>
            <span className="text-2xl font-semibold tabular-nums">{brl(order.total)}</span>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-card surface p-5 text-sm shadow-sm">
        <h2 className="mb-3 font-semibold">Veículo</h2>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2">
          <dt className="text-slate-500">Modelo</dt>
          <dd>
            {order.vehicle.brand} {order.vehicle.model}
          </dd>
          <dt className="text-slate-500">Ano</dt>
          <dd>{order.vehicle.year ?? '—'}</dd>
          <dt className="text-slate-500">Cor</dt>
          <dd className="capitalize">{order.vehicle.color?.toLowerCase() ?? '—'}</dd>
          <dt className="text-slate-500">Km na entrada</dt>
          <dd>{order.mileageAtEntry != null ? `${order.mileageAtEntry.toLocaleString('pt-BR')} km` : '—'}</dd>
        </dl>
        {order.description && (
          <>
            <h3 className="mb-1 mt-4 font-semibold">Solicitação na abertura</h3>
            <p className="whitespace-pre-wrap text-slate-700">{order.description}</p>
          </>
        )}
      </section>
    </div>
  );
}
