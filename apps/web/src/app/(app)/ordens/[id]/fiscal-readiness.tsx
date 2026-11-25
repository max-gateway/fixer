import { CheckCircle2, CircleAlert } from 'lucide-react';
import type { FiscalIssue, FiscalReadiness } from '@/lib/service-hours';

function IssueList({ title, issues }: { title: string; issues: FiscalIssue[] }) {
  return (
    <li className="space-y-0.5">
      <p className="text-sm font-medium">{title}</p>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">
        {issues.map((i) => (
          <li key={i.field}>{i.message}</li>
        ))}
      </ul>
    </li>
  );
}

/** Pendências fiscais da ordem. Só informa: nada é emitido por aqui. */
export function FiscalReadinessList({ readiness }: { readiness: FiscalReadiness }) {
  const { nfe, nfse } = readiness;
  if (!nfe.required && !nfse.required) return null;

  if (readiness.ready) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <CheckCircle2 aria-hidden className="size-4 text-emerald-600" /> Dados fiscais completos para{' '}
        {[nfe.required && 'NF-e', nfse.required && 'NFS-e'].filter(Boolean).join(' e ')}.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CircleAlert aria-hidden className="size-4 text-amber-600" /> Faltam dados fiscais para emitir
      </p>
      {nfe.items.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Peças (NF-e)</p>
          <ul className="space-y-2">
            {nfe.items.map((i) => (
              <IssueList key={i.name} title={i.name} issues={i.issues} />
            ))}
          </ul>
        </div>
      )}
      {(nfse.items.length > 0 || nfse.settingsIssues.length > 0) && (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Serviços (NFS-e)</p>
          <ul className="space-y-2">
            {nfse.settingsIssues.length > 0 && <IssueList title="Configuração da oficina" issues={nfse.settingsIssues} />}
            {nfse.items.map((i) => (
              <IssueList key={i.name} title={i.name} issues={i.issues} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
