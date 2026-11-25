import { getAccessToken } from '@/auth';

// Chamadas server-side direto à API (Server Components). Do navegador, usar /api/*.
export type Customer = {
  id: string;
  name: string;
  document: string | null; // null = cadastro pendente (o cliente completa no portal)
  phone: string | null;
  email: string | null;
};

export class ApiError extends Error {
  constructor(readonly status: number, path: string) {
    super(`API ${status} em ${path}`);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const token = await getAccessToken();
  if (!token) throw new Error('Não autenticado');
  const res = await fetch(`${base}${path}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, path);
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
