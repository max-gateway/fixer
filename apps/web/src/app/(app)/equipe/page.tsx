import { TriangleAlert } from 'lucide-react';
import { ApiError, apiGet } from '@/lib/api';
import { DEFAULT_FILTERS, filtersToParams, PAGE_SIZE, type Access, type Filters, type PersonPage, type Position, type Unit } from '@/lib/workforce';
import { TeamWorkspace } from './team-workspace';

export const metadata = { title: 'Equipe' };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EquipePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const status = first(sp.status);
  const filters: Filters = {
    q: first(sp.q)?.slice(0, 100) ?? '',
    status: status === 'inactive' ? 'inactive' : status === 'all' ? '' : DEFAULT_FILTERS.status,
  };

  try {
    const [page, units, positions, access] = await Promise.all([
      apiGet<PersonPage>(`/workforce/people?${filtersToParams(filters, PAGE_SIZE)}`),
      apiGet<{ items: Unit[] }>('/workforce/units'),
      apiGet<{ items: Position[] }>('/workforce/positions'),
      apiGet<Access>('/workforce/access'),
    ]);
    return <TeamWorkspace initial={{ filters, page, units: units.items, positions: positions.items }} access={access} openId={first(sp.open) ?? null} />;
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    const unavailable = err instanceof ApiError && err.status === 503;
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>
            {denied
              ? 'Você não tem permissão para ver a equipe.'
              : unavailable
                ? (err.detail ?? 'A equipe está indisponível no momento. Tente de novo em instantes.')
                : 'Não foi possível carregar a equipe. Tente de novo em instantes.'}
          </p>
        </div>
      </section>
    );
  }
}
