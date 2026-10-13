/** Erro com mensagem já pronta para exibir ao usuário (vinda da API ou de falha de rede). */
export class ClientApiError extends Error {}

/** GET nas rotas /api/* a partir do navegador (usado em useQuery). */
export async function getJson<T = unknown>(url: string, fallback = 'Falha ao carregar.'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new ClientApiError('Falha de rede. Verifique a conexão e tente de novo.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ClientApiError(json.message ?? fallback);
  return json as T;
}

/** POST JSON nas rotas /api/* a partir do navegador (usado em useMutation). */
export function postJson<T = unknown>(url: string, body: unknown, fallback = 'Falha ao salvar.'): Promise<T> {
  return sendJson<T>('POST', url, body, fallback);
}

/** PUT JSON nas rotas /api/* (configurações). */
export function putJson<T = unknown>(url: string, body: unknown, fallback = 'Falha ao salvar.'): Promise<T> {
  return sendJson<T>('PUT', url, body, fallback);
}

/** PATCH JSON nas rotas /api/* (alterações parciais). */
export function patchJson<T = unknown>(url: string, body: unknown, fallback = 'Falha ao salvar.'): Promise<T> {
  return sendJson<T>('PATCH', url, body, fallback);
}

/** DELETE nas rotas /api/* (sem corpo). */
export function deleteJson<T = unknown>(url: string, fallback = 'Falha ao remover.'): Promise<T> {
  return sendJson<T>('DELETE', url, undefined, fallback);
}

async function sendJson<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body: unknown, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ClientApiError('Falha de rede. Verifique a conexão e tente de novo.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ClientApiError(json.message ?? fallback);
  return json as T;
}
