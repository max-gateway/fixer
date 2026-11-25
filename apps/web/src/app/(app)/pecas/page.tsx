import { PartsExplorer } from '@/components/parts/parts-explorer';
import { parseState } from '@/lib/part-search';

export const metadata = { title: 'Catálogo de peças' };

export default async function PecasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) params.append(k, item);
  return <PartsExplorer initial={parseState(params)} />;
}
