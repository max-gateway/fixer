/** Chamadas do navegador ao portal, via proxy público /api/portal (sem sessão). */
export class PortalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function portalFetch<T>(token: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/portal/${encodeURIComponent(token)}${path}`, {
      method: init?.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    throw new PortalApiError('Sem conexão. Verifique sua internet.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PortalApiError(body.message ?? 'Algo deu errado. Tente novamente.', res.status);
  return body as T;
}
