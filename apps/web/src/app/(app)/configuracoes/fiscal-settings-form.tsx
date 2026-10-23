'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { describedBy, Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { putJson } from '@/lib/client-api';

export type FiscalSettings = {
  municipalityIbge: string | null;
  taxRegime: 'SIMPLES' | 'PRESUMIDO' | 'REAL' | null;
  issRate: string | number | null; // Decimal chega como string
  municipalServiceCode: string | null;
  hourlyRate: string | number | null;
  lc116Item?: string | null;
  cnae?: string | null;
};

const num = (v: string): number | null | 'invalid' => {
  if (v.trim() === '') return null;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 'invalid';
};
const show = (v: string | number | null | undefined) => (v == null ? '' : String(Number(v)).replace('.', ','));

export function FiscalSettingsForm({ initial }: { initial: FiscalSettings | null }) {
  const router = useRouter();
  const [regime, setRegime] = useState(initial?.taxRegime ?? '');
  const [ibge, setIbge] = useState(initial?.municipalityIbge ?? '');
  const [iss, setIss] = useState(show(initial?.issRate));
  const [code, setCode] = useState(initial?.municipalServiceCode ?? '');
  const [hourly, setHourly] = useState(show(initial?.hourlyRate));
  const [submitted, setSubmitted] = useState(false);

  const issN = num(iss);
  const hourlyN = num(hourly);
  const errors = {
    ibge: ibge !== '' && !/^\d{7}$/.test(ibge) ? 'O código IBGE tem 7 dígitos' : null,
    iss: issN === 'invalid' || (typeof issN === 'number' && !(issN > 0 && issN <= 5)) ? 'Informe uma alíquota maior que 0 e até 5%' : null,
    hourly: hourlyN === 'invalid' || (typeof hourlyN === 'number' && hourlyN < 0) ? 'Informe um valor válido' : null,
  };
  const shown = submitted ? errors : { ibge: null, iss: null, hourly: null };

  const save = useMutation({
    mutationFn: (body: object) => putJson('/api/fiscal/settings', body, 'Falha ao salvar a configuração.'),
    onSuccess: () => router.refresh(),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (errors.ibge || errors.iss || errors.hourly) return;
    save.mutate({
      municipalityIbge: ibge || null,
      taxRegime: regime || null,
      issRate: issN as number | null,
      municipalServiceCode: code.trim() || null,
      hourlyRate: hourlyN as number | null,
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-xl space-y-4 rounded-xl border bg-card surface p-5 shadow-xs">
      <Field id="regime" label="Regime tributário" optional>
        <Select {...describedBy('regime')} value={regime} onChange={(e) => setRegime(e.target.value as typeof regime)}>
          <option value="">Não informado</option>
          <option value="SIMPLES">Simples Nacional</option>
          <option value="PRESUMIDO">Lucro presumido</option>
          <option value="REAL">Lucro real</option>
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ibge" label="Município (código IBGE)" optional error={shown.ibge} hint="7 dígitos, ex.: 3550308">
          <Input {...describedBy('ibge', shown.ibge, true)} inputMode="numeric" maxLength={7} value={ibge} onChange={(e) => setIbge(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field id="iss" label="Alíquota de ISS (%)" optional error={shown.iss} hint="Vem da prefeitura (NFS-e Nacional) quando ela cadastrou">
          <Input {...describedBy('iss', shown.iss, true)} inputMode="decimal" placeholder="ex.: 2,5" value={iss} onChange={(e) => setIss(e.target.value)} />
        </Field>
      </div>

      <Field id="svc-code" label="Código de tributação municipal" optional hint="Só se a prefeitura exigir na nota de serviço; a NFS-e Nacional usa o código nacional do serviço.">
        <Input {...describedBy('svc-code', null, true)} value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
      </Field>

      <Field id="hourly" label="Valor da hora de mão de obra (R$)" optional error={shown.hourly} hint="Usado em serviços com preço por hora">
        <Input {...describedBy('hourly', shown.hourly, true)} inputMode="decimal" placeholder="ex.: 120" value={hourly} onChange={(e) => setHourly(e.target.value)} />
      </Field>

      {save.error && (
        <p role="alert" className="text-sm text-red-600">
          {save.error.message}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 aria-hidden className="animate-spin" />}
          Salvar
        </Button>
        {save.isSuccess && (
          <span role="status" className="flex items-center gap-1 text-sm text-emerald-700">
            <Check aria-hidden className="size-4" /> Salvo
          </span>
        )}
      </div>
    </form>
  );
}
