import { portalOrigin } from '@/lib/portal-url';
import { NewOrderForm } from './new-order-form';

export default async function NovaOrdemPage() {
  return <NewOrderForm portalOrigin={await portalOrigin()} />;
}
