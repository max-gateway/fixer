import { Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { type InvoiceNotice, type NoticeTone } from '@/lib/invoice-view';
import { cn } from '@/lib/utils';

const TONE: Record<NoticeTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-950',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  danger: 'border-red-200 bg-red-50 text-red-900',
};

/** Caixa de aviso única das telas de nota: mesmo ícone, cor e papel para o mesmo tom, na lista, no painel e na página. */
export function Callout({ tone, children, className }: { tone: NoticeTone; children: ReactNode; className?: string }) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-xl border p-3.5 text-sm', TONE[tone], className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

/** Os avisos da situação da nota (de `invoiceNotices`). `max` limita quantos aparecem: o painel mostra só o principal. */
export function InvoiceNotices({ notices, max }: { notices: InvoiceNotice[]; max?: number }) {
  const shown = max ? notices.slice(0, max) : notices;
  if (shown.length === 0) return null;
  return (
    <div className="space-y-3">
      {shown.map((n) => (
        <Callout key={n.id} tone={n.tone}>
          <p className={cn(n.detail && 'font-semibold')}>{n.title}</p>
          {n.detail && <p>{n.detail}</p>}
        </Callout>
      ))}
    </div>
  );
}
