'use client';

import { Building2, RefreshCw } from 'lucide-react';
import { syncHealth, relativeTime, type FiscalStatus } from '@/lib/fiscal-import';
import { formatCnpj } from '@/lib/invoices';
import { cn } from '@/lib/utils';

const DOT = { ok: 'bg-emerald-500', warn: 'bg-amber-500', error: 'bg-red-600', off: 'bg-muted-foreground/50' } as const;

/** Empresa que recebe as notas e o pulso da SEFAZ: última e próxima consulta, sempre com o tempo relativo vivo. */
export function SyncStatus({ status, now }: { status: FiscalStatus | null; now: number }) {
  const company = status?.settings;
  const cred = status?.credential;
  const health = cred ? syncHealth(cred, now) : null;
  const s = cred?.syncState;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {company?.cnpj ? (
        <span className="inline-flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 shadow-xs">
          <Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <strong className="truncate font-semibold">{company.legalName || 'Empresa sem razão social'}</strong>
          <span className="tabular shrink-0 text-muted-foreground">{formatCnpj(company.cnpj)}</span>
        </span>
      ) : (
        status && <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-900">Nenhuma empresa cadastrada para importar notas</span>
      )}

      {health && (
        <span
          title={health.detail ?? 'A SEFAZ limita a consulta a cerca de uma vez por hora, então uma nota recém-emitida pode demorar a aparecer.'}
          className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-xs', health.tone === 'warn' || health.tone === 'error' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'bg-card text-muted-foreground')}
        >
          <span className="relative flex size-2">
            {health.tone === 'ok' && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', DOT.ok)} />}
            <span className={cn('relative inline-flex size-2 rounded-full', DOT[health.tone])} />
          </span>
          {health.tone === 'ok' && cred?.enabled ? (
            <span>
              Consultado {relativeTime(s?.lastSuccessAt ?? null, now)} <span aria-hidden>·</span> próxima {relativeTime(s?.nextPollAt ?? null, now)}
            </span>
          ) : (
            <span className="font-medium">{health.title}</span>
          )}
          <RefreshCw aria-hidden className="size-3 opacity-50" />
        </span>
      )}
    </div>
  );
}
