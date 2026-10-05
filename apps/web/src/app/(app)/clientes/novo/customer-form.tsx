'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const FIELD = 'w-full rounded border border-slate-300 px-3 py-2';

export function CustomerForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? 'Falha ao salvar.');
        return;
      }
      router.push('/clientes');
      router.refresh();
    } catch {
      setError('Falha de rede.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <label className="block space-y-1 text-sm">
        <span>Nome</span>
        <input name="name" required className={FIELD} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>CPF / CNPJ</span>
        <input name="document" required inputMode="numeric" className={FIELD} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Telefone</span>
        <input name="phone" type="tel" className={FIELD} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>E-mail</span>
        <input name="email" type="email" className={FIELD} />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded bg-brand px-4 py-2 transition hover:bg-brand-hover font-medium text-white disabled:opacity-60"
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}
