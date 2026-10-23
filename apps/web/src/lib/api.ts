import { getAccessToken } from '@/auth';
import { orgHeader } from './org-server';

// Chamadas server-side direto à API (Server Components). Do navegador, usar /api/*.
export type Customer = {
  id: string;
  name: string;
  document: string | null; // null = cadastro pendente (o cliente completa no portal)
  phone: string | null;
  email: string | null;
};

export class ApiError extends Error {
  /** `message` do corpo da resposta da API, quando veio (ex.: "Sem permissão: access.read", "Token sem organização ..."). */
  constructor(readonly status: number, path: string, readonly detail?: string) {
    super(`API ${status} em ${path}`);
  }

  /**
   * 403 por falta de permissão (PermissionGuard). Outros 403 têm outra causa e outra solução: oficina não resolvida pelo token,
   * pessoa que não participa da oficina escolhida.
   */
  get permissionDenied(): boolean {
    return this.status === 403 && (!this.detail || this.detail.startsWith('Sem permissão'));
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const token = await getAccessToken();
  if (!token) throw new Error('Não autenticado');
  const res = await fetch(`${base}${path}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, ...(await orgHeader()) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new ApiError(res.status, path, typeof body?.message === 'string' ? body.message : undefined);
  }
  return res.json() as Promise<T>;
}

export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

export function formatDocument(doc: string | null): string {
  if (!doc) return 'Cadastro pendente';
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}
