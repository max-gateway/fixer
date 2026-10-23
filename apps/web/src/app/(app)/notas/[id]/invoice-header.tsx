import { Boxes, FileText, Link2Off, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { invoiceFacts, invoiceMeta, type InvoiceFull } from '@/lib/invoice-view';
import { describeInvoice, money } from '@/lib/invoices';
import { cn } from '@/lib/utils';
import { InvoiceMore } from './invoice-more';
import { InvoiceStepper } from './invoice-stepper';
import { firstUnresolved, invoiceSteps } from './steps';

/** Cartões com os quatro números da nota; "Sem peça" é um atalho para o primeiro item pendente. */
function FactCards({ inv }: { inv: InvoiceFull }) {
  const f = invoiceFacts(inv);
  const first = firstUnresolved(inv.items);
  const cards: { label: string; value: string; icon: ReactNode; warn?: boolean; href?: string }[] = [
    { label: 'Valor da nota', value: money(f.total), icon: <Wallet /> },
    { label: 'Itens', value: f.items, icon: <Boxes /> },
    { label: 'Finalidade', value: f.finality, icon: <FileText /> },
    { label: 'Sem peça', value: f.unresolved, icon: <Link2Off />, warn: f.unresolvedCount > 0, href: f.unresolvedCount > 0 && first !== null ? `#item-${first}` : undefined },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const body = (
          <>
            <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4', c.warn ? 'bg-amber-100 text-amber-800' : 'bg-brand-soft text-brand')}>
              {c.icon}
            </span>
            <span className="min-w-0">
              <dt className="text-xs text-muted-foreground">{c.label}</dt>
              <dd className={cn('tabular truncate text-lg font-semibold leading-tight', c.warn && 'text-amber-800')}>{c.value}</dd>
            </span>
          </>
        );
        const cls = cn('flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 shadow-xs', c.href && 'transition-colors hover:border-amber-300 hover:bg-amber-50/60 focus-visible:outline-2 focus-visible:outline-offset-2');
        return c.href ? (
          <a key={c.label} href={c.href} className={cls} aria-label={`${c.label}: ${c.value}. Ir para o primeiro item pendente`}>
            {body}
          </a>
        ) : (
          <div key={c.label} className={cls}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}

/** Topo da nota: fornecedor e situação, números-chave, etapas e a ação principal. */
export function InvoiceHeader({ inv, actions }: { inv: InvoiceFull; actions: ReactNode }) {
  const s = describeInvoice(inv);
  return (
    <header className="space-y-4 rounded-2xl border bg-card surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{inv.issuerName || 'Fornecedor não identificado'}</h1>
          <p className="text-sm text-muted-foreground">{invoiceMeta(inv)}</p>
        </div>
        <Badge variant={s.tone} className="px-3 py-1 text-sm">
          {s.label}
        </Badge>
      </div>

      <FactCards inv={inv} />
      <InvoiceStepper steps={invoiceSteps(inv)} />

      <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-4">
        <div className="min-w-0 flex-1">{actions}</div>
        <InvoiceMore id={inv.id} accessKey={inv.accessKey} hasXml={inv.hasXml} />
      </div>
    </header>
  );
}
