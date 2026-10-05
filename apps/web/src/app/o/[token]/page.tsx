import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBranding } from '@/lib/branding';
import type { PortalOrder } from '@/lib/portal';
import { Portal } from './portal';

// O token na URL é a credencial: nada de indexação nem de vazar o link via Referer.
export function generateMetadata(): Metadata {
  return {
    title: `${getBranding().displayName} · Sua ordem de serviço`,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

  let res: Response;
  try {
    res = await fetch(`${base}/portal/${encodeURIComponent(token)}`, { cache: 'no-store' });
  } catch {
    throw new Error('Serviço temporariamente indisponível.');
  }
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API ${res.status}`);
  const order = (await res.json()) as PortalOrder;

  const b = getBranding();
  return <Portal token={token} initial={order} shop={{ name: b.displayName, logoUrl: b.logoUrl }} />;
}
