'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { describedBy, Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { isValidCnpj, maskCnpj, normalizeCnpj, UF_CODES } from '@/lib/cnpj';
import { putJson } from '@/lib/client-api';
import type { FiscalStatus } from '@/lib/fiscal-import';

/** CNPJ, razão social e UF: o CNPJ é o que a SEFAZ consulta e o que o certificado precisa acompanhar (mesma raiz). */
export function CompanyForm({ initial, locked }: { initial: FiscalStatus['settings']; locked: boolean }) {
  const router = useRouter();
  const [cnpj, setCnpj] = useState(initial?.cnpj ? maskCnpj(initial.cnpj) : '');
  const [name, setName] = useState(initial?.legalName ?? '');
  const [uf, setUf] = useState(initial?.ufCode ? String(initial.ufCode) : '');
  const [submitted, setSubmitted] = useState(false);

  const normalized = normalizeCnpj(cnpj);
  const cnpjError = !isValidCnpj(normalized) ? (normalized.length < 14 ? 'O CNPJ tem 14 caracteres' : 'CNPJ inválido: confira os dígitos') : null;
  const shown = submitted ? cnpjError : null;
  const changed = normalized !== (initial?.cnpj ?? '') || name.trim() !== (initial?.legalName ?? '') || uf !== (initial?.ufCode ? String(initial.ufCode) : '');

  const save = useMutation({
    mutationFn: (body: object) => putJson('/api/fiscal/company', body, 'Não foi possível salvar os dados da empresa.'),
    onSuccess: () => router.refresh(),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (cnpjError) return;
    save.mutate({ cnpj: normalized, ...(name.trim() ? { legalName: name.trim() } : {}), ...(uf ? { ufCode: Number(uf) } : {}) });
  }

  const hint = locked ? 'Vem do certificado. Para trocar de empresa, remova o certificado no passo 1.' : 'Aceita o CNPJ novo com letras e números.';
  return (
    <form onSubmit={onSubmit} noValidate className="max-w-xl space-y-4 rounded-xl border bg-card surface p-5 shadow-xs">
      <Field id="cnpj" label="CNPJ da oficina" error={shown} hint={hint}>
        <Input
          {...describedBy('cnpj', shown, hint)}
          value={cnpj}
          readOnly={locked}
          onChange={(e) => setCnpj(maskCnpj(e.target.value))}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="00.000.000/0000-00"
          className="max-w-64 tabular"
        />
      </Field>
      <Field id="legal-name" label="Razão social" optional>
        <Input {...describedBy('legal-name')} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="uf" label="UF da oficina" optional hint="Ajuda a SEFAZ a localizar as notas mais rápido.">
        <Select {...describedBy('uf', null, true)} value={uf} onChange={(e) => setUf(e.target.value)} className="max-w-40">
          <option value="">Não informar</option>
          {UF_CODES.map((u) => (
            <option key={u.code} value={u.code}>
              {u.sigla}
            </option>
          ))}
        </Select>
      </Field>

      {save.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {save.error.message}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending || (!changed && Boolean(initial?.cnpj))}>
          {save.isPending && <Loader2 aria-hidden className="animate-spin" />}
          Salvar
        </Button>
        {save.isSuccess && !changed && (
          <span role="status" className="flex items-center gap-1 text-sm text-emerald-700">
            <Check aria-hidden className="size-4" /> Salvo
          </span>
        )}
      </div>
    </form>
  );
}
