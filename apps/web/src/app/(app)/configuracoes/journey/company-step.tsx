'use client';

import { useMutation } from '@tanstack/react-query';
import { Briefcase, Building2, Check, Fingerprint, Loader2, MapPin, Map as MapIcon, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UF_CODES } from '@/lib/cnpj';
import { postJson } from '@/lib/client-api';
import { autofillNotices, provenanceTag, stepNotes, type AutofillProvenance, type AutofillReport } from '@/lib/fiscal-autofill';
import type { FiscalStatus } from '@/lib/fiscal-import';
import { formatCnpj } from '@/lib/invoices';
import type { FiscalSettings } from '../fiscal-settings-form';
import { DataItem, Note, Surface } from './ui';

type Props = { company: NonNullable<FiscalStatus['settings']>; fiscal: FiscalSettings | null; provenance: AutofillProvenance; hasCredential: boolean };

/** O que a consulta de CNPJ trouxe sozinha, com a fonte de cada valor. Corrigir à mão fica nos ajustes de Tributário. */
export function CompanyStep({ company, fiscal, provenance, hasCredential }: Props) {
  const router = useRouter();
  const refresh = useMutation({
    mutationFn: () => postJson<AutofillReport>('/api/fiscal/autofill', {}, 'Não foi possível atualizar os dados agora.'),
    onSuccess: () => router.refresh(),
  });
  const notices = refresh.data ? [...autofillNotices(refresh.data), ...stepNotes(refresh.data)] : [];
  const tag = (field: string) => provenanceTag(provenance.fields.find((f) => f.field === field));
  const uf = UF_CODES.find((u) => u.code === company.ufCode)?.sigla ?? null;
  const cnae = fiscal?.cnae ? fiscal.cnae.replace(/^(\d{4})(\d)(\d{2})$/, '$1-$2/$3') : null;

  return (
    <div className="space-y-4">
      <Surface className="p-0 sm:p-0">
        <div className="flex items-center gap-3 border-b p-4 sm:p-5">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-secondary text-white">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display truncate text-lg font-semibold">{company.legalName ?? 'Razão social não encontrada'}</p>
            <p className="tabular text-sm text-muted-foreground">{company.cnpj ? formatCnpj(company.cnpj) : '—'}</p>
          </div>
        </div>
        <div className="grid gap-5 p-4 sm:grid-cols-2 sm:p-5">
          <DataItem icon={Fingerprint} label="CNPJ" value={company.cnpj ? formatCnpj(company.cnpj) : null} source={hasCredential ? 'Do certificado digital' : null} />
          <DataItem icon={Building2} label="Razão social" value={company.legalName} source={company.legalName ? 'Receita Federal (consulta de CNPJ)' : null} />
          <DataItem icon={MapIcon} label="UF" value={uf} />
          <DataItem icon={MapPin} label="Município (IBGE)" value={fiscal?.municipalityIbge ?? null} source={tag('municipalityIbge')?.text} estimated={tag('municipalityIbge')?.estimated} />
          <DataItem icon={Briefcase} label="Atividade (CNAE)" value={cnae} source={tag('cnae')?.text} estimated={tag('cnae')?.estimated} className="sm:col-span-2" />
        </div>
      </Surface>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />} Buscar de novo nas fontes oficiais
        </Button>
        {refresh.isSuccess && notices.length === 0 ? (
          <span role="status" className="flex items-center gap-1 text-sm text-emerald-700">
            <Check aria-hidden className="size-4" /> Tudo atualizado
          </span>
        ) : (
          <p className="text-xs text-muted-foreground">
            Algo errado? Corrija em{' '}
            <Link href="/configuracoes/tributario#ajustes" className="font-medium underline underline-offset-2">
              ajustes manuais
            </Link>
            : valor digitado nunca é trocado sozinho.
          </p>
        )}
      </div>

      {notices.length > 0 && (
        <Note tone="warn" icon={TriangleAlert}>
          {notices.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Note>
      )}
      {refresh.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {refresh.error.message}
        </p>
      )}
    </div>
  );
}
