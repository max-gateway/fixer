'use client';

import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNcm, FISCAL_STATUS, type ResolvedFiscal } from '@/lib/part-search';
import { cn } from '@/lib/utils';
import { useFiscal } from './use-parts';

const FIELDS: { key: 'ncm' | 'cest' | 'origin' | 'exTipi'; label: string }[] = [
  { key: 'ncm', label: 'NCM' },
  { key: 'cest', label: 'CEST' },
  { key: 'origin', label: 'Origem' },
  { key: 'exTipi', label: 'EX TIPI' },
];

const SOURCE: Record<string, string> = { BULK: 'carga do catálogo', ADMIN: 'curadoria', NFE_CONSENSUS: 'notas fiscais', MANUAL: 'ajuste da oficina' };
const CONFIDENCE: Record<string, string> = { CONFIRMADO: 'confirmado', ESTIMADO: 'estimado', INFORMADO: 'informado' };
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{children}</p>;

function value(f: ResolvedFiscal, key: (typeof FIELDS)[number]['key']): string | null {
  const v = f.item[key];
  if (!v) return null;
  return key === 'ncm' ? formatNcm(v) : v;
}

/** Como a classificação foi decidida: herdada do catálogo, ajustada pela oficina e a confiança de cada fonte. */
function origin(f: ResolvedFiscal, key: string): string | null {
  const field = f.fields[key];
  if (!field) return null;
  // O ajuste da oficina é sempre manual: repetir a fonte seria redundante.
  const parts = [field.from === 'OVERRIDE' ? 'Ajuste da oficina' : 'Cadastro global', field.source === 'MANUAL' ? null : (SOURCE[field.source] ?? field.source), CONFIDENCE[field.confidence] ?? field.confidence];
  return parts.filter(Boolean).join(' · ');
}

function Status({ f }: { f: ResolvedFiscal }) {
  const s = FISCAL_STATUS[f.fiscalStatus];
  const Icon = s.tone === 'ok' ? CircleCheck : s.tone === 'wait' ? CircleHelp : CircleAlert;
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4', s.tone === 'ok' && 'border-emerald-200 bg-emerald-50 text-emerald-950', s.tone === 'wait' && 'bg-muted/50', s.tone === 'bad' && 'border-red-200 bg-red-50 text-red-950')}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-0.5">
        <p className="text-sm font-semibold">{s.label}</p>
        <p className="text-sm">{s.hint}</p>
        {f.missing.length > 0 && <p className="text-xs">Falta: {f.missing.map((m) => (m === 'exTipi' ? 'EX TIPI' : m === 'unit' ? 'unidade' : m === 'origin' ? 'origem' : m === 'attributes' ? 'atributos' : m.toUpperCase())).join(', ')}.</p>}
      </div>
    </div>
  );
}

/** Classificação fiscal resolvida da peça (NCM, CEST, origem), com a origem de cada dado e o aceite do contador. Só leitura. */
export function FiscalTab({ sku }: { sku: string }) {
  const q = useFiscal(sku);
  if (q.isLoading) return <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;
  if (q.isError)
    return (
      <div className="space-y-3">
        <Empty>{q.error.message}</Empty>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  const f = q.data?.fiscal;
  if (!f) return <Empty>O catálogo não tem a classificação fiscal desta peça.</Empty>;

  const r = f.review;
  return (
    <div className="space-y-6">
      <Status f={f} />

      <dl className="divide-y rounded-xl border text-sm">
        {FIELDS.map(({ key, label }) => {
          const v = value(f, key);
          return (
            <div key={key} className="flex items-start justify-between gap-4 px-3 py-2">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 text-right">
                <span className={cn('tabular', !v && 'text-muted-foreground')}>{v ?? 'Não informado'}</span>
                {v && origin(f, key) && <span className="block text-xs text-muted-foreground">{origin(f, key)}</span>}
              </dd>
            </div>
          );
        })}
        <div className="flex items-start justify-between gap-4 px-3 py-2">
          <dt className="shrink-0 text-muted-foreground">Unidade</dt>
          <dd className={cn('tabular text-right', !f.unit && 'text-muted-foreground')}>{f.unit ?? 'Não informada'}</dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">
        {r.accepted
          ? r.stale
            ? 'O contador aceitou uma classificação anterior; ela mudou depois e precisa de novo aceite.'
            : `Aceito pelo contador${r.reviewedAt ? ` em ${dateFmt.format(new Date(r.reviewedAt))}` : ''}.`
          : 'Ainda sem o aceite do contador.'}
      </p>
    </div>
  );
}
