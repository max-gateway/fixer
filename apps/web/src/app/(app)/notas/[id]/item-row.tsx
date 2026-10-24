'use client';

import { useMutation } from '@tanstack/react-query';
import { Ban, CircleCheck, CircleDashed, Library, Link2, Loader2, Sparkles, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { InvoiceSuggestion } from '@/lib/catalog';
import { putJson } from '@/lib/client-api';
import type { InvoiceItem } from '@/lib/invoices';
import { money, qty } from '@/lib/invoices';
import type { WithCost } from '@/lib/invoice-cost';
import { cn } from '@/lib/utils';
import { ItemFiscalLine } from '@/components/invoice/item-fiscal';
import { CostBreakdown } from './cost-breakdown';
import { CatalogLinkForm, ResolvePanel } from './resolve-panel';

type Mode = 'idle' | 'resolve' | 'catalog';

const ORIGIN: Record<InvoiceItem['resolution'], string | null> = {
  UNRESOLVED: null,
  AUTO_MAP: 'Automático (vínculo do fornecedor)',
  AUTO_EAN: 'Automático (código de barras)',
  MANUAL: 'Escolhido por você',
  IGNORED: null,
};

/** Um item da nota: dados do XML à esquerda, vínculo com a peça à direita, com as ações da conciliação. */
export function ItemRow({ invoiceId, item, editable, suggestion }: { invoiceId: string; item: WithCost<InvoiceItem>; editable: boolean; suggestion?: InvoiceSuggestion }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('idle');
  const [fromSuggestion, setFromSuggestion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    setMode('idle');
    setFromSuggestion(false);
    setError(null);
    router.refresh();
  };
  const fail = (e: Error) => setError(e.message);

  const act = useMutation({
    mutationFn: (body: object) => putJson(`/api/invoices/${invoiceId}/items/${item.itemNumber}`, body, 'Não foi possível salvar o vínculo.'),
    onSuccess: done,
    onError: fail,
  });

  const resolved = item.resolution !== 'UNRESOLVED';
  const factor = Number(item.unitFactor);
  // A sugestão só vale para item ainda sem peça, em nota que ainda aceita conciliação.
  const showSuggestion = !!suggestion && editable && !resolved && mode === 'idle';
  const canLinkCatalog = editable && resolved && !!item.part && item.part.catalogSku === null;

  return (
    <li
      id={`item-${item.itemNumber}`}
      className={cn(
        'scroll-mt-24 space-y-3 rounded-xl border border-l-4 bg-card px-4 py-4 shadow-xs transition-shadow target:ring-2 target:ring-brand/40',
        !resolved && 'border-l-amber-400',
        resolved && item.resolution !== 'IGNORED' && 'border-l-emerald-500',
        item.resolution === 'IGNORED' && 'border-l-muted-foreground/30',
      )}
    >
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="flex items-start gap-2.5 text-sm font-medium">
            <span aria-hidden className="tabular mt-px grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {item.itemNumber}
            </span>
            <span className="min-w-0">
              <span className="sr-only">Item {item.itemNumber}: </span>
              {item.description}
            </span>
          </p>
          <p className="tabular mt-2 inline-flex flex-wrap items-center gap-x-2 rounded-lg bg-muted/50 px-2.5 py-1 text-sm">
            <span>
              {qty(item.quantity)} {item.unit} × {money(item.unitPrice)}
            </span>
            <span aria-hidden className="text-muted-foreground">
              =
            </span>
            <strong>{money(item.totalPrice)}</strong>
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Código {item.supplierCode} · <ItemFiscalLine item={item} />
          </p>
          {item.cost && <CostBreakdown cost={item.cost} />}
        </div>

        <div className="min-w-0 space-y-2">
          {item.resolution === 'IGNORED' && (
            <p className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">Não é estoque</Badge>
              <span className="text-xs text-muted-foreground">Não entra no estoque.</span>
            </p>
          )}
          {resolved && item.part && (
            <div className="space-y-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge variant="success">
                  <CircleCheck aria-hidden /> Vinculado
                </Badge>
                {item.part.catalogSku ? <Badge variant="secondary">No catálogo</Badge> : <Badge variant="outline">Só da oficina</Badge>}
              </span>
              <p className="text-sm font-medium">{item.part.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.part.sku} · {ORIGIN[item.resolution]}
              </p>
              <p className="tabular text-xs text-muted-foreground">
                Entra no estoque: <strong className="text-foreground">{qty(Number(item.quantity) * factor)}</strong> un
                {factor !== 1 && ` (${qty(factor)} por ${item.unit})`}
              </p>
            </div>
          )}
          {!resolved && (
            <Badge variant="warning">
              <CircleDashed aria-hidden /> Sem peça
            </Badge>
          )}
          {showSuggestion && (
            <section aria-label="Sugestão do catálogo" className="space-y-2 rounded-lg border border-brand/30 bg-brand/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                <Sparkles aria-hidden className="size-3.5" /> Sugestão
              </p>
              <p className="text-sm">
                Esta peça já está no seu estoque: <strong>{suggestion.partName}</strong>
                <span className="text-muted-foreground"> ({suggestion.partSku})</span>
              </p>
              <p className="text-xs text-muted-foreground">Achada pelo código de barras no catálogo. Confira as unidades por embalagem antes de salvar.</p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setFromSuggestion(true);
                  setMode('resolve');
                }}
              >
                <Link2 aria-hidden /> Usar esta peça
              </Button>
            </section>
          )}

          {editable && mode === 'idle' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" variant={resolved ? 'outline' : 'default'} onClick={() => setMode('resolve')}>
                <Link2 aria-hidden /> {item.part ? 'Trocar peça' : 'Definir peça'}
              </Button>
              {!resolved && (
                <Button type="button" size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: 'ignore' })}>
                  <Ban aria-hidden /> Não é estoque
                </Button>
              )}
              {canLinkCatalog && (
                <Button type="button" size="sm" variant="outline" onClick={() => setMode('catalog')}>
                  <Library aria-hidden /> Vincular ao catálogo
                </Button>
              )}
              {resolved && (
                <Button type="button" size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: 'reset' })}>
                  {act.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Undo2 aria-hidden />} Desfazer
                </Button>
              )}
            </div>
          )}
          {error && mode === 'idle' && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>

      {mode === 'resolve' && (
        <ResolvePanel
          invoiceId={invoiceId}
          item={item}
          preselect={fromSuggestion && suggestion ? { id: suggestion.partId, sku: suggestion.partSku, name: suggestion.partName } : undefined}
          onCancel={() => {
            setMode('idle');
            setFromSuggestion(false);
          }}
          onDone={done}
        />
      )}
      {mode === 'catalog' && item.part && <CatalogLinkForm part={item.part} onCancel={() => setMode('idle')} onDone={done} />}
    </li>
  );
}
