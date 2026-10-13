'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UF_CODES } from '@/lib/cnpj';
import { lookupCompany, settingsFromHints } from '@/lib/company-autofill';
import { putJson } from '@/lib/client-api';
import { formatCnpj } from '@/lib/invoices';

const REGIME: Record<string, string> = { SIMPLES: 'Simples Nacional', PRESUMIDO: 'Lucro presumido', REAL: 'Lucro real' };

type Props = {
  cnpj: string;
  legalName: string | null;
  ufCode: number | null;
  municipalityIbge: string | null;
  taxRegime: string | null;
};

/** O que o Fixer já sabe da oficina (vindo do certificado + consulta de CNPJ) e o que ainda falta. */
export function CompanyOverview({ cnpj, legalName, ufCode, municipalityIbge, taxRegime }: Props) {
  const router = useRouter();
  const refresh = useMutation({
    mutationFn: async () => {
      const { company, hints, found } = await lookupCompany(cnpj);
      if (!found) throw new Error('Não foi possível consultar o CNPJ agora. Tente de novo em instantes.');
      await putJson('/api/fiscal/company', company, 'Não foi possível salvar os dados da empresa.');
      await putJson('/api/fiscal/settings', settingsFromHints(hints, false), 'Não foi possível salvar a configuração fiscal.');
    },
    onSuccess: () => router.refresh(),
  });

  const uf = UF_CODES.find((u) => u.code === ufCode)?.sigla;
  const rows: [string, string | null, string?][] = [
    ['CNPJ', formatCnpj(cnpj)],
    ['Razão social', legalName],
    ['UF', uf ?? null],
    ['Município (IBGE)', municipalityIbge],
    ['Regime tributário', taxRegime ? (REGIME[taxRegime] ?? taxRegime) : null, 'Escolha abaixo: a consulta só identifica o Simples Nacional.'],
  ];

  return (
    <div className="max-w-xl space-y-3 rounded-xl border bg-card p-5 shadow-xs">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map(([label, value, missing]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value ?? <span className="font-normal text-amber-800">{missing ?? 'Não encontrado'}</span>}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="button" variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />} Atualizar pela Receita
        </Button>
        {refresh.isSuccess && (
          <span role="status" className="flex items-center gap-1 text-sm text-emerald-700">
            <Check aria-hidden className="size-4" /> Atualizado
          </span>
        )}
      </div>
      {refresh.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {refresh.error.message}
        </p>
      )}
    </div>
  );
}
