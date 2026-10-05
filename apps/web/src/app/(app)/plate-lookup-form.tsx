'use client';

import { useState, type FormEvent } from 'react';
import { PlateCapture } from '@/components/plate-capture';

type Dados = {
  marca?: string | null;
  modelo?: string | null;
  cor?: string | null;
  ano?: number | null;
  anoModelo?: number | null;
  municipio?: string | null;
  uf?: string | null;
  combustivel?: string | null;
};

// Placa antiga (ABC1234) ou Mercosul (ABC1D23).
const PLATE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; dados: Dados };

export function PlateLookupForm() {
  const [plate, setPlate] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!PLATE.test(normalized)) {
      setState({ status: 'error', message: 'Placa inválida.' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const res = await fetch(`/api/vehicles/plate-lookup/${normalized}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: 'error', message: body.message ?? 'Falha na consulta.' });
        return;
      }
      setState({ status: 'ok', dados: body.result?.basico?.dados ?? {} });
    } catch {
      setState({ status: 'error', message: 'Falha de rede.' });
    }
  }

  const rows: [string, string | number | null | undefined][] =
    state.status === 'ok'
      ? [
          ['Marca', state.dados.marca],
          ['Modelo', state.dados.modelo],
          ['Cor', state.dados.cor],
          ['Ano / modelo', [state.dados.ano, state.dados.anoModelo].filter(Boolean).join(' / ')],
          ['Combustível', state.dados.combustivel],
          ['Local', [state.dados.municipio, state.dados.uf].filter(Boolean).join(' - ')],
        ]
      : [];

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          placeholder="ABC1D23"
          maxLength={8}
          aria-label="Placa"
          className="w-40 rounded border border-slate-300 px-3 py-2 uppercase tracking-widest"
        />
        <button
          type="submit"
          disabled={state.status === 'loading'}
          className="rounded bg-brand px-4 py-2 transition hover:bg-brand-hover font-medium text-white disabled:opacity-60"
        >
          {state.status === 'loading' ? 'Consultando…' : 'Consultar'}
        </button>
      </form>

      <PlateCapture onPlate={setPlate} />

      {state.status === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}

      {state.status === 'ok' && (
        <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-y-2 rounded border border-slate-200 bg-white p-4">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm text-slate-500">{label}</dt>
              <dd>{value || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
