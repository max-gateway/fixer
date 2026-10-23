import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Callout } from '@/components/invoice/notices';
import type { CostAlert } from '@/lib/invoice-cost';
import type { InvoiceNotice } from '@/lib/invoice-view';

/**
 * Tudo o que a nota pede de atenção num lugar só. O que exige decisão (aviso de perigo ou de cuidado, alerta de custo) fica à
 * vista; o que só informa (nota pronta, ciência registrada, frete conhecido) vai para "Informações", fechado.
 */
export function AttentionPanel({ notices, alerts, action }: { notices: InvoiceNotice[]; alerts: CostAlert[]; action?: (alert: CostAlert) => ReactNode }) {
  const important = notices.filter((n) => n.tone !== 'info');
  const infoNotices = notices.filter((n) => n.tone === 'info');
  const importantAlerts = alerts.filter((a) => a.severity === 'warning');
  const infoAlerts = alerts.filter((a) => a.severity !== 'warning');
  const info = infoNotices.length + infoAlerts.length;
  if (important.length + importantAlerts.length + info === 0) return null;

  const alertView = (a: CostAlert, i: number, tone: 'warning' | 'info') => (
    <Callout key={`${a.code}-${i}`} tone={tone}>
      <p>{a.message}</p>
      {a.itemNumbers.length > 0 && <p className="text-xs">Itens: {a.itemNumbers.join(', ')}</p>}
      {action?.(a)}
    </Callout>
  );
  const noticeView = (n: InvoiceNotice) => (
    <Callout key={n.id} tone={n.tone}>
      <p className={n.detail ? 'font-semibold' : undefined}>{n.title}</p>
      {n.detail && <p>{n.detail}</p>}
    </Callout>
  );

  return (
    <section aria-label="Avisos da nota" className="space-y-3">
      {important.map(noticeView)}
      {importantAlerts.map((a, i) => alertView(a, i, 'warning'))}
      {info > 0 && (
        <details className="group rounded-xl border bg-card shadow-xs open:pb-1" open={important.length + importantAlerts.length === 0 && info <= 1}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
            <span>
              Informações <span className="tabular text-muted-foreground">({info})</span>
            </span>
            <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 px-3 pb-3">
            {infoNotices.map(noticeView)}
            {infoAlerts.map((a, i) => alertView(a, i, 'info'))}
          </div>
        </details>
      )}
    </section>
  );
}
