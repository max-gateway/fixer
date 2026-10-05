import { notFound } from 'next/navigation';
import { portalOrigin } from '@/lib/portal-url';
import { apiGet, formatDocument, formatPhone } from '@/lib/api';
import { brl, isTerminal, STATUS_LABEL, type OrderDetail } from '@/lib/orders';
import { OrderDeliveries } from '@/components/notifications/order-deliveries';
import { PortalSection } from './portal-section';
import { StatusActions } from './status-actions';

export default async function OrdemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let order: OrderDetail;
  try {
    order = await apiGet<OrderDetail>(`/service-orders/${encodeURIComponent(id)}`);
  } catch {
    notFound();
  }

  const portalUrl = `${await portalOrigin()}/o/${order.portalToken}`;

  const partsTotal = order.partLines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
  const servicesTotal = order.serviceLines.reduce((sum, l) => sum + Number(l.price), 0);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ordem #{order.number}</h1>
        <p className="text-sm text-slate-600">{STATUS_LABEL[order.status]}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-4 text-sm">
          <h2 className="mb-1 font-semibold">Cliente</h2>
          <p>{order.customer.name}</p>
          <p className="text-slate-600">{formatDocument(order.customer.document)}</p>
          {order.customer.phone && <p className="text-slate-600">{formatPhone(order.customer.phone)}</p>}
        </div>
        <div className="rounded border border-slate-200 bg-white p-4 text-sm">
          <h2 className="mb-1 font-semibold">Veículo</h2>
          <p>
            {order.vehicle.plate} · {order.vehicle.brand} {order.vehicle.model}
          </p>
          {order.mileageAtEntry != null && (
            <p className="text-slate-600">{order.mileageAtEntry} km na entrada</p>
          )}
        </div>
      </div>

      {order.description && (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm">
          <h2 className="mb-1 font-semibold">Solicitação</h2>
          <p className="whitespace-pre-wrap">{order.description}</p>
        </div>
      )}

      <div className="rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">Itens</h2>
        <table className="w-full text-left">
          <tbody>
            {order.partLines.map((l) => (
              <tr key={l.id}>
                <td className="py-1">{l.partName}</td>
                <td className="py-1 text-slate-600">
                  {Number(l.quantity)} × {brl(l.unitPrice)}
                </td>
                <td className="py-1 text-right">{brl(Number(l.quantity) * Number(l.unitPrice))}</td>
              </tr>
            ))}
            {order.serviceLines.map((l) => (
              <tr key={l.id}>
                <td className="py-1">{l.serviceName}</td>
                <td className="py-1 text-slate-600">Serviço</td>
                <td className="py-1 text-right">{brl(l.price)}</td>
              </tr>
            ))}
            {order.partLines.length + order.serviceLines.length === 0 && (
              <tr>
                <td className="py-1 text-slate-600">Sem itens.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-semibold">
              <td className="py-2" colSpan={2}>
                Total
              </td>
              <td className="py-2 text-right">{brl(partsTotal + servicesTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <StatusActions orderId={order.id} nextStatuses={order.nextStatuses} />

      <div className="rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">Histórico</h2>
        <ul className="space-y-1">
          {order.statusLogs.map((log) => (
            <li key={log.id}>
              {new Date(log.createdAt).toLocaleString('pt-BR')} — {STATUS_LABEL[log.toStatus]} por{' '}
              {log.changedBy.name}
              {log.note && <span className="text-slate-600"> ({log.note})</span>}
            </li>
          ))}
        </ul>
      </div>

      <OrderDeliveries orderId={order.id} />

      <PortalSection
        orderId={order.id}
        portalUrl={portalUrl}
        customerName={order.customer.name}
        customerPhone={order.customer.phone}
        whatsappLink={{ linked: order.whatsappLinkedAt !== null, last4: order.whatsappLinkedPhone?.slice(-4) ?? null, code: order.linkCode }}
        initialEvents={order.events}
        initialChecklist={order.checklist}
        closed={isTerminal(order.status)}
      />
    </section>
  );
}
