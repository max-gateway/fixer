'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ClientApiError, postJson } from '@/lib/client-api';
import { isValidCnpj, maskCnpj, normalizeCnpj } from '@/lib/cnpj';
import { maskPhone } from '@/lib/masks';

const FIELD = 'w-full rounded border border-slate-300 px-3 py-2';

interface CnpjLookupResult {
  razao_social?: string | null;
  nome_fantasia?: string | null;
  situacao?: string | null;
  telefones: string[];
  emails: string[];
  endereco?: {
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    municipio?: string | null;
    uf?: string | null;
    cep?: string | null;
  } | null;
  inscricoes_estaduais: { numero: string; uf: string; situacao?: string | null; tipo?: string | null }[];
}

/** Dados que a consulta de CNPJ preenche e que vão junto no POST (sem campo visível no formulário). */
interface Registry {
  zipCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  tradeName?: string | null;
  stateRegistration?: string | null;
  stateRegistrationStatus?: string | null;
  registryCheckedAt?: string;
}

export function CustomerForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [registry, setRegistry] = useState<Registry>({});
  const [ies, setIes] = useState<CnpjLookupResult['inscricoes_estaduais']>([]);
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => postJson('/api/customers', data),
    onSuccess: () => {
      router.push('/clientes');
      router.refresh();
    },
  });

  const cnpj = normalizeCnpj(document);
  const canLookup = isValidCnpj(cnpj);

  // Cada consulta gasta crédito do CNPJá: só dispara no clique, nunca ao digitar.
  const lookup = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/customers/cnpj-lookup/${encodeURIComponent(cnpj)}`).catch(() => null);
      if (!res) throw new ClientApiError('Falha de rede. Verifique a conexão e tente de novo.');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ClientApiError(json.message ?? 'Falha ao consultar CNPJ.');
      return json as CnpjLookupResult;
    },
    onSuccess: (r) => {
      const a = r.endereco;
      const sameUf = r.inscricoes_estaduais.filter((ie) => ie.uf === a?.uf);
      // Uma IE na UF do endereço é a que vale para a oficina; com várias, o usuário vê a lista abaixo.
      const ie = sameUf.length === 1 ? sameUf[0] : null;
      setName(r.razao_social ?? '');
      if (r.telefones[0]) setPhone(maskPhone(r.telefones[0]));
      if (r.emails[0]) setEmail(r.emails[0]);
      setIes(r.inscricoes_estaduais);
      setRegistry({
        zipCode: a?.cep,
        street: a?.logradouro,
        number: a?.numero,
        complement: a?.complemento,
        district: a?.bairro,
        city: a?.municipio,
        state: a?.uf,
        tradeName: r.nome_fantasia,
        stateRegistration: ie?.numero ?? null,
        stateRegistrationStatus: ie?.situacao ?? null,
        registryCheckedAt: new Date().toISOString(),
      });
      setLookupNote(r.situacao && r.situacao !== 'Ativa' ? `Atenção: situação cadastral "${r.situacao}".` : null);
    },
  });

  const saving = save.isPending;
  const error = save.error?.message ?? null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate({ name, document, phone, email, ...registry });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <label className="block space-y-1 text-sm">
        <span>CPF / CNPJ</span>
        <div className="flex gap-2">
          <input
            name="document"
            required
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            onBlur={() => canLookup && setDocument(maskCnpj(cnpj))}
            className={FIELD}
          />
          {canLookup && (
            <button
              type="button"
              onClick={() => lookup.mutate()}
              disabled={lookup.isPending}
              className="shrink-0 rounded border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
            >
              {lookup.isPending ? 'Buscando…' : 'Buscar CNPJ'}
            </button>
          )}
        </div>
      </label>
      {lookup.error && (
        <p role="alert" className="text-sm text-red-600">
          {lookup.error.message}
        </p>
      )}
      {lookupNote && <p className="text-sm text-amber-700">{lookupNote}</p>}

      <label className="block space-y-1 text-sm">
        <span>Nome</span>
        <input name="name" required value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Telefone</span>
        <input name="phone" type="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} className={FIELD} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>E-mail</span>
        <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
      </label>

      {registry.registryCheckedAt && (
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          {registry.tradeName && <p>Nome fantasia: {registry.tradeName}</p>}
          {registry.street && (
            <p>
              {registry.street}, {registry.number}
              {registry.complement ? ` — ${registry.complement}` : ''} · {registry.district} · {registry.city}/{registry.state}
            </p>
          )}
          {ies.length === 0 ? (
            <p>Sem Inscrição Estadual encontrada.</p>
          ) : (
            <label className="block space-y-1">
              <span>Inscrição Estadual</span>
              <select
                value={registry.stateRegistration ?? ''}
                onChange={(e) => {
                  const ie = ies.find((i) => i.numero === e.target.value);
                  setRegistry((r) => ({
                    ...r,
                    stateRegistration: ie?.numero ?? null,
                    stateRegistrationStatus: ie?.situacao ?? null,
                  }));
                }}
                className={FIELD}
              >
                <option value="">Nenhuma</option>
                {ies.map((ie) => (
                  <option key={`${ie.uf}-${ie.numero}`} value={ie.numero}>
                    {ie.uf} · {ie.numero}
                    {ie.situacao ? ` · ${ie.situacao}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

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
