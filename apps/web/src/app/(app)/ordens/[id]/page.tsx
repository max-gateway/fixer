import { ArrowLeft, Gauge, MessageSquareText, Phone, User } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { OrderDeliveries } from '@/components/notifications/order-deliveries';
import { Plate, StatusBadge } from '@/components/orders/status-badge';
import { apiGet, formatDocument, formatPhone } from '@/lib/api';
import { brl, isTerminal, STATUS_STYLE, type OrderDetail } from '@/lib/orders';
import { portalOrigin } from '@/lib/portal-url';
import { cn } from '@/lib/utils';
import type { FiscalReadiness } from '@/lib/service-hours';
import { AddService } from './add-service';
import { FiscalReadinessList } from './fiscal-readiness';
import { PortalSection } from './portal-section';
import { ServiceHours } from './service-hours';
import { StatusActions } from './status-actions';

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border bg-card p-5 shadow-xs', className)}>
      <h2 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

export default async function OrdemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let order: OrderDetail;
  try {
    order = await apiGet<OrderDetail>(`/service-orders/${encodeURIComponent(id)}`);
  } catch {
    notFound();
  }

  // Pendências fiscais são informativas: se a consulta falhar, a página continua sem o painel.
  const readiness = await apiGet<FiscalReadiness>(`/service-orders/${encodeURIComponent(id)}/fiscal-readiness`).catch(() => null);
  const canAddService = ['QUOTE', 'APPROVED', 'IN_PROGRESS', 'AWAITING_PART'].includes(order.status);

  const portalUrl = `${await portalOrigin()}/o/${order.portalToken}`;
  const parts = order.partLines.map((l) => ({ id: l.id, name: l.partName, detail: `${Number(l.quantity)} × ${brl(l.unitPrice)}`, total: Number(l.quantity) * Number(l.unitPrice) }));
  const services = order.serviceLines.map((l) => ({ id: l.id, name: l.serviceName, detail: 'Serviço', total: Number(l.price) }));
  const lines = [...parts, ...services];
  const partsTotal = parts.reduce((s, l) => s + l.total, 0);
  const servicesTotal = services.reduce((s, l) => s + l.total, 0);

  return (
    <section className="space-y-6">
      <div>
        <Link href="/ordens" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-4" /> Ordens
        </Link>
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="tabular text-2xl font-semibold tracking-tight">Ordem #{order.number}</h1>
          <StatusBadge status={order.status} className="text-sm" />
          <span className="text-xs text-muted-foreground sm:ml-auto">
            Aberta em {new Date(order.createdAt).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </header>
      </div>

      {order.nextStatuses.length > 0 && (
        <div className="rounded-xl border bg-card surface p-4 shadow-xs md:sticky md:top-2 md:z-20 md:bg-card/90 md:backdrop-blur">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Avançar ordem</p>
          <StatusActions orderId={order.id} nextStatuses={order.nextStatuses} />
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="Cliente">
              <p className="flex items-center gap-2 font-medium">
                <User aria-hidden className="size-4 text-muted-foreground" /> {order.customer.name}
              </p>
              <p className="tabular mt-1 text-sm text-muted-foreground">{formatDocument(order.customer.document)}</p>
              {order.customer.phone && (
                <p className="tabular mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone aria-hidden className="size-3.5" /> {formatPhone(order.customer.phone)}
                </p>
              )}
            </Panel>
            <Panel title="Veículo">
              <Plate value={order.vehicle.plate} className="text-sm" />
              <p className="mt-2 font-medium">
                {order.vehicle.brand} {order.vehicle.model}
              </p>
              {order.mileageAtEntry != null && (
                <p className="tabular mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Gauge aria-hidden className="size-3.5" /> {order.mileageAtEntry.toLocaleString('pt-BR')} km na entrada
                </p>
              )}
            </Panel>
          </div>

          {order.description && (
            <Panel title="Solicitação do cliente">
              <p className="flex gap-3 text-sm whitespace-pre-wrap">
                <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {order.description}
              </p>
            </Panel>
          )}

          <Panel title="Peças e serviços">
            {lines.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhum item adicionado.</p>
            ) : (
              <ul className="divide-y">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-baseline gap-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="tabular text-xs text-muted-foreground">{l.detail}</span>
                    </span>
                    <span className="tabular font-medium">{brl(l.total)}</span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="tabular mt-3 space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <dt>Peças</dt>
                <dd>{brl(partsTotal)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Serviços</dt>
                <dd>{brl(servicesTotal)}</dd>
              </div>
              <div className="flex items-baseline justify-between pt-1 text-lg font-semibold">
                <dt>Total</dt>
                <dd>{brl(partsTotal + servicesTotal)}</dd>
              </div>
            </dl>
          </Panel>

          {(order.serviceLines.length > 0 || canAddService) && (
            <Panel title="Serviços e horas">
              {order.serviceLines.length > 0 && <ServiceHours orderId={order.id} status={order.status} lines={order.serviceLines} />}
              {canAddService && (
                <div className={order.serviceLines.length > 0 ? 'mt-3' : undefined}>
                  <AddService orderId={order.id} vehicleId={order.vehicle.id} />
                </div>
              )}
            </Panel>
          )}

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
        </div>

        <aside className="min-w-0 space-y-6">
          {readiness && (readiness.nfe.required || readiness.nfse.required) && (
            <Panel title="Fiscal">
              <FiscalReadinessList readiness={readiness} />
            </Panel>
          )}
          <Panel title="Histórico">
            <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
              {[...order.statusLogs].reverse().map((log) => (
                <li key={log.id} className="relative pl-6">
                  <span aria-hidden className={cn('absolute top-1.5 left-0 size-[11px] rounded-full ring-4 ring-card', STATUS_STYLE[log.toStatus].dot)} />
                  <StatusBadge status={log.toStatus} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {log.changedBy.name} · {new Date(log.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                  {log.note && <p className="mt-0.5 text-sm">{log.note}</p>}
                </li>
              ))}
            </ol>
          </Panel>
          <OrderDeliveries orderId={order.id} />
        </aside>
      </div>
    </section>
  );
}
