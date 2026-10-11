import { DashboardView } from '@/components/dashboard/dashboard-view';
import { apiGet, ApiError } from '@/lib/api';
import type { DashboardOverview } from '@/lib/dashboard';

const RANGES = ['7d', '30d', '90d'] as const;

// Painel inicial: todos os números vêm prontos de GET /dashboard; esta página só repassa para a tela.
export default async function Home({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const selected = RANGES.find((r) => r === range) ?? '30d';

  let data: DashboardOverview | null = null;
  let failure = '';
  try {
    data = await apiGet<DashboardOverview>(`/dashboard?range=${selected}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      failure = 'Sua sessão não é mais válida. Clique em "Sair" e entre novamente.';
    } else if (e instanceof ApiError) {
      failure = `A API respondeu com erro ${e.status} ao carregar o painel.`;
    } else {
      console.error('[painel] falha ao chamar /dashboard', e);
      const detail = e instanceof Error ? ` (${e.message}${e.cause ? `: ${String(e.cause)}` : ''})` : '';
      failure = `Não foi possível carregar o painel${detail}.`;
    }
  }

  if (!data) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {failure}
      </p>
    );
  }
  return <DashboardView data={data} />;
}
