import Link from 'next/link';
import { apiGet, formatDocument, type Customer } from '@/lib/api';

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  let customers: Customer[] = [];
  let error: string | null = null;
  try {
    customers = await apiGet<Customer[]>(`/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`);
  } catch {
    error = 'Não foi possível carregar os clientes.';
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clientes</h1>
        <Link href="/clientes/novo" className="rounded bg-brand px-4 py-2 transition hover:bg-brand-hover font-medium text-white">
          Novo cliente
        </Link>
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nome ou documento"
          aria-label="Buscar"
          className="w-80 rounded border border-slate-300 px-3 py-2"
        />
        <button className="rounded border border-slate-300 px-4 py-2">Buscar</button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!error && customers.length === 0 && <p className="text-slate-600">Nenhum cliente encontrado.</p>}

      {customers.length > 0 && (
        <table className="w-full overflow-hidden rounded border border-slate-200 bg-card text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Documento</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">E-mail</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2">{formatDocument(c.document)}</td>
                <td className="px-4 py-2">{c.phone ?? '—'}</td>
                <td className="px-4 py-2">{c.email ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
