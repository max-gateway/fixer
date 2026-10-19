'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, HelpCircle, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UF_CODES } from '@/lib/cnpj';
import { postJson, putJson } from '@/lib/client-api';
import { autofillNotices, provenanceTag, type AutofillProvenance, type AutofillReport } from '@/lib/fiscal-autofill';
import { formatCnpj } from '@/lib/invoices';

const REGIME: Record<string, string> = { SIMPLES: 'Simples Nacional', PRESUMIDO: 'Lucro presumido', REAL: 'Lucro real' };

type Props = {
  cnpj: string;
  legalName: string | null;
  ufCode: number | null;
  municipalityIbge: string | null;
  taxRegime: string | null;
  lc116Item: string | null;
  provenance: AutofillProvenance;
};

/** O que o Fixer já sabe da oficina (certificado + fontes oficiais), de onde veio cada dado, e o que ainda falta. */
export function CompanyOverview({ cnpj, legalName, ufCode, municipalityIbge, taxRegime, lc116Item, provenance }: Props) {
  const router = useRouter();
  const refresh = useMutation({
    mutationFn: () => postJson<AutofillReport>('/api/fiscal/autofill', {}, 'Não foi possível atualizar os dados agora.'),
    onSuccess: () => router.refresh(),
  });
  const notices = refresh.data ? autofillNotices(refresh.data) : [];
  const prov = (field: string) => provenanceTag(provenance.fields.find((f) => f.field === field));

  const uf = UF_CODES.find((u) => u.code === ufCode)?.sigla;
  const rows: { label: string; value: string | null; field?: string }[] = [
    { label: 'CNPJ', value: formatCnpj(cnpj) },
    { label: 'Razão social', value: legalName },
    { label: 'UF', value: uf ?? null },
    { label: 'Município (IBGE)', value: municipalityIbge, field: 'municipalityIbge' },
    { label: 'Regime tributário', value: taxRegime ? (REGIME[taxRegime] ?? taxRegime) : null, field: 'taxRegime' },
    { label: 'Serviço (LC 116)', value: lc116Item, field: 'lc116Item' },
  ];

  return (
    <div className="max-w-xl space-y-3 rounded-xl border bg-card p-5 shadow-xs">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map(({ label, value, field }) => {
          const tag = field ? prov(field) : null;
          return (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value ?? <span className="font-normal text-amber-800">{field === 'taxRegime' ? 'Responda abaixo' : 'Não encontrado'}</span>}</dd>
              {value && tag && <dd className={`text-xs ${tag.estimated ? 'text-amber-800' : 'text-muted-foreground'}`}>{tag.text}</dd>}
            </div>
          );
        })}
      </dl>

      {!taxRegime && <RegimeQuestion simplesOptant={provenance.simplesOptant} />}

      {notices.length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {notices.map((n) => (
            <p key={n} className="flex items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {n}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="button" variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />} Atualizar pela Receita
        </Button>
        {refresh.isSuccess && notices.length === 0 && (
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

/**
 * Pergunta guiada (spec §6.2): a consulta pública só identifica o Simples. Com a resposta, roda de novo o preenchimento,
 * que completa o que depende do regime (ICMS da venda no Presumido).
 */
function RegimeQuestion({ simplesOptant }: { simplesOptant: boolean | null }) {
  const router = useRouter();
  const answer = useMutation({
    mutationFn: async (taxRegime: 'SIMPLES' | 'PRESUMIDO' | 'REAL') => {
      await putJson('/api/fiscal/settings', { taxRegime }, 'Não foi possível salvar o regime.');
      await postJson('/api/fiscal/autofill', {}, 'Regime salvo, mas não foi possível completar os outros dados agora.');
    },
    onSuccess: () => router.refresh(),
  });
  const options = (simplesOptant === false ? ['PRESUMIDO', 'REAL'] : ['SIMPLES', 'PRESUMIDO', 'REAL']) as ('SIMPLES' | 'PRESUMIDO' | 'REAL')[];

  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="flex items-start gap-2 font-medium">
        <HelpCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        {simplesOptant === false
          ? 'A Receita informa que a empresa não é do Simples Nacional. Ela é do Lucro Presumido ou do Lucro Real?'
          : 'Qual é o regime tributário da empresa?'}
      </p>
      <p className="pl-6 text-sky-900">Se não souber, pergunte ao contador. Dá para mudar depois em Impostos.</p>
      <div className="flex flex-wrap gap-2 pl-6">
        {options.map((r) => (
          <Button key={r} type="button" size="sm" variant="outline" className="bg-card" disabled={answer.isPending} onClick={() => answer.mutate(r)}>
            {answer.isPending && answer.variables === r && <Loader2 aria-hidden className="animate-spin" />}
            {REGIME[r]}
          </Button>
        ))}
      </div>
      {answer.error && (
        <p role="alert" className="pl-6 font-medium text-destructive">
          {answer.error.message}
        </p>
      )}
    </div>
  );
}
