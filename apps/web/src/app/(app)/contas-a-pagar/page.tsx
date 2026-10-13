import { TriangleAlert } from 'lucide-react';
import { ApiError, apiGet } from '@/lib/api';
import { filtersFromParams, filtersToParams, type Forecast, type Listing, type Summary } from '@/lib/payables';
import { PAGE_SIZE } from './constants';
import { PayablesWorkspace, type Access } from './payables-workspace';

export const metadata = { title: 'Contas a pagar' };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ContasAPagarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const filters = filtersFromParams((k) => first(sp[k]));
  const openId = first(sp.open) ?? null;

  try {
    const [listing, summary, forecast, access] = await Promise.all([
      apiGet<Listing>(`/payables?${filtersToParams(filters, { forApi: true })}&take=${PAGE_SIZE}`),
      apiGet<Summary>('/payables/summary'),
      apiGet<Forecast>('/payables/forecast'),
      apiGet<Access>('/payables/access'),
    ]);
    return <PayablesWorkspace initial={{ filters, limit: PAGE_SIZE, listing, summary, forecast }} access={access} openId={openId} compose={first(sp.nova) === '1'} />;
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Contas a pagar</h1>
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>{denied ? 'Você não tem permissão para ver as contas a pagar.' : 'Não foi possível carregar as contas a pagar. Tente de novo em instantes.'}</p>
        </div>
      </section>
    );
  }
}
