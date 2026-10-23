'use client';

import { ArrowUpRight, CheckCheck, CircleCheck, CircleDashed, CircleSlash, FileDown, Loader2, MousePointerClick, PackageCheck, ShieldCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { CostAlerts } from '@/components/invoice/cost-alerts';
import { InvoiceFacts } from '@/components/invoice/facts';
import { ItemFiscalLine, ItemLandedCost } from '@/components/invoice/item-fiscal';
import { InvoiceNotices } from '@/components/invoice/notices';
import { TaxIncidence } from '@/components/invoice/tax-incidence';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { WithCost } from '@/lib/invoice-cost';
import { invoiceMeta, invoiceNotices, type InvoiceFull } from '@/lib/invoice-view';
import { describeInvoice, formatKey, money, nextAction, qty, type InvoiceItem } from '@/lib/invoices';
import { cn } from '@/lib/utils';
import type { ActionKind } from './hooks';

function ItemLine({ item }: { item: WithCost<InvoiceItem> }) {
  const Icon = item.resolution === 'UNRESOLVED' ? CircleDashed : item.resolution === 'IGNORED' ? CircleSlash : CircleCheck;
  return (
    <li className="flex items-start gap-2.5 py-2">
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', item.resolution === 'UNRESOLVED' ? 'text-amber-600' : item.resolution === 'IGNORED' ? 'text-muted-foreground' : 'text-emerald-600')} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{item.description}</p>
        <p className="truncate text-xs text-muted-foreground">
          {item.part ? <span className="text-foreground/80">→ {item.part.sku} · {item.part.name}</span> : item.resolution === 'IGNORED' ? 'Ignorado' : `Código ${item.supplierCode}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <ItemFiscalLine item={item} />
        </p>
      </div>
      <div className="tabular shrink-0 text-right">
        <p className="text-sm">{money(item.totalPrice)}</p>
        <p className="text-xs text-muted-foreground">
          {qty(item.quantity)} {item.unit}
        </p>
        <p className="text-xs text-muted-foreground">
          <ItemLandedCost item={item} />
        </p>
      </div>
    </li>
  );
}

export function PreviewEmpty() {
  return (
    <div className="grid h-full min-h-64 place-items-center rounded-xl border border-dashed bg-card surface/50 p-8 text-center">
      <div className="space-y-2">
        <MousePointerClick aria-hidden className="mx-auto size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Escolha uma nota</p>
        <p className="text-xs text-muted-foreground">
          Os detalhes e a ação principal aparecem aqui. Use <kbd className="rounded border bg-muted px-1">J</kbd> e <kbd className="rounded border bg-muted px-1">K</kbd> para navegar.
        </p>
      </div>
    </div>
  );
}

/** Painel da nota selecionada: resumo, orientação, itens e a ação principal, sem sair da lista. */
export function PreviewPane({
  detail,
  loading,
  error,
  pending,
  canAct,
  onAction,
}: {
  detail: InvoiceFull | undefined;
  loading: boolean;
  error: boolean;
  pending: ActionKind | null;
  canAct: boolean;
  onAction: (kind: ActionKind, inv: InvoiceFull) => void;
}) {
  if (loading && !detail) {
    return (
      <div className="space-y-3 p-5" aria-busy>
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-20" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <p role="alert" className="m-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> Não foi possível abrir esta nota.
      </p>
    );
  }

  const inv = detail;
  const s = describeInvoice(inv);
  const action = nextAction(inv);
  const notices = invoiceNotices(inv);
  const busy = (k: ActionKind) => pending === k;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-4 overflow-y-auto p-5">
        <header className="space-y-1 pr-8">
          <Badge variant={s.tone}>{s.label}</Badge>
          <h2 className="pt-1 text-lg leading-tight font-semibold tracking-tight">{inv.issuerName || 'Fornecedor não identificado'}</h2>
          <p className="text-xs text-muted-foreground">{invoiceMeta(inv)}</p>
        </header>

        <InvoiceFacts inv={inv} />

        <InvoiceNotices notices={notices} max={1} />
        <CostAlerts alerts={inv.costAlerts ?? []} />

        <TaxIncidence items={inv.items} stacked />

        {inv.items.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Itens</h3>
            <ul className="divide-y">
              {inv.items.map((i) => (
                <ItemLine key={i.id} item={i} />
              ))}
            </ul>
          </div>
        )}

        <p className="tabular text-[11px] break-all text-muted-foreground">Chave: {formatKey(inv.accessKey)}</p>
      </div>

      <footer className="mt-auto flex flex-wrap gap-2 border-t bg-background/80 p-4 backdrop-blur">
        {action === 'confirm' && canAct && (
          <Button onClick={() => onAction('confirm', inv)} disabled={pending !== null} className="flex-1">
            {busy('confirm') ? <Loader2 aria-hidden className="animate-spin" /> : <PackageCheck aria-hidden />} Lançar entrada <kbd className="ml-1 hidden rounded bg-white/20 px-1 text-[10px] sm:inline">E</kbd>
          </Button>
        )}
        {action === 'manifest' && canAct && (
          <Button onClick={() => onAction('manifest', inv)} disabled={pending !== null} className="flex-1">
            {busy('manifest') ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />} Dar ciência e baixar XML <kbd className="ml-1 hidden rounded bg-white/20 px-1 text-[10px] sm:inline">E</kbd>
          </Button>
        )}
        {action === 'review' && canAct && (
          <Button onClick={() => onAction('clear-review', inv)} disabled={pending !== null} className="flex-1">
            {busy('clear-review') ? <Loader2 aria-hidden className="animate-spin" /> : <CheckCheck aria-hidden />} Revisei esta nota
          </Button>
        )}
        <Link href={`/notas/${inv.id}`} className={buttonVariants({ variant: action === 'reconcile' ? 'default' : 'outline', className: action === 'reconcile' ? 'flex-1' : undefined })}>
          {action === 'reconcile' ? 'Conciliar itens' : 'Abrir nota'} <ArrowUpRight aria-hidden />
        </Link>
        {inv.hasXml && (
          <a href={`/api/invoices/${inv.id}/xml`} download className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label="Baixar XML" title="Baixar XML">
            <FileDown aria-hidden />
          </a>
        )}
      </footer>
    </div>
  );
}
