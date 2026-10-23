import { invoiceFacts, type InvoiceFull } from '@/lib/invoice-view';
import { money } from '@/lib/invoices';
import { cn } from '@/lib/utils';

/** Os números do topo da nota: valor, itens, finalidade e itens sem peça. Os mesmos quatro no painel e na página. */
export function InvoiceFacts({ inv, className }: { inv: Pick<InvoiceFull, 'status' | 'finality' | 'totalAmount' | 'items'>; className?: string }) {
  const f = invoiceFacts(inv);
  const cells: { label: string; value: string; warn?: boolean }[] = [
    { label: 'Valor da nota', value: money(f.total) },
    { label: 'Itens', value: f.items },
    { label: 'Finalidade', value: f.finality },
    { label: 'Sem peça', value: f.unresolved, warn: f.unresolvedCount > 0 },
  ];
  return (
    <dl className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm', className)}>
      {cells.map((c) => (
        <div key={c.label} className="bg-card px-3 py-2">
          <dt className="text-[11px] text-muted-foreground">{c.label}</dt>
          <dd className={cn('tabular font-semibold', c.warn && 'text-amber-800')}>{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}
