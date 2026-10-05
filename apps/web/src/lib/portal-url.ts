import { headers } from 'next/headers';

/**
 * Origem pública do portal do cliente: PORTAL_PUBLIC_URL (runtime, por tenant) ou, no dev, o host da
 * requisição. Só no servidor. O link de uma ordem é `${origin}/o/${portalToken}`.
 */
export async function portalOrigin(): Promise<string> {
  const fromEnv = process.env.PORTAL_PUBLIC_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
}
