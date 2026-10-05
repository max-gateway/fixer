import { apiGet } from '@/lib/api';
import type { Part, Service } from '@/lib/orders';
import { portalOrigin } from '@/lib/portal-url';
import { NewOrderForm } from './new-order-form';

export default async function NovaOrdemPage() {
  const [parts, services, origin] = await Promise.all([apiGet<Part[]>('/parts'), apiGet<Service[]>('/services'), portalOrigin()]);
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Nova ordem de serviço</h1>
      <NewOrderForm parts={parts} services={services} portalOrigin={origin} />
    </section>
  );
}
