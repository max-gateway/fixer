import { ArrowLeft, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaxIncidence } from '@/components/invoice/tax-incidence';
import { ApiError, apiGet } from '@/lib/api';
import { invoiceNotices, type InvoiceFull } from '@/lib/invoice-view';
import { AttentionPanel } from './attention';
import { EntryTaxPayable } from './entry-tax-payable';
import { InvoiceActions } from './invoice-actions';
import { InvoiceHeader } from './invoice-header';
import { ItemRow } from './item-row';
import { PricingPanel } from './pricing-panel';
import { firstUnresolved } from './steps';

export const metadata = { title: 'Nota de compra' };

export default async function NotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let inv: InvoiceFull;
  try {
    inv = await apiGet<InvoiceFull>(`/invoices/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
        <BackLink />
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="font-semibold">{denied ? 'Você não tem permissão para ver esta nota.' : 'Não foi possível carregar a nota.'}</p>
        </div>
      </section>
    );
  }

  const editable = inv.status === 'FULL' && (inv.exportStatus === 'PENDING_MATCH' || inv.exportStatus === 'READY');
  const canManifest = inv.status === 'SUMMARY';
  const unresolvedCount = inv.items.filter((i) => i.resolution === 'UNRESOLVED').length;
  const ready = editable && inv.exportStatus === 'READY' && !inv.needsReview;
  const hasPricing = editable && inv.items.some((i) => i.resolution !== 'UNRESOLVED' && i.resolution !== 'IGNORED');
  // Itens sem peça primeiro: é o trabalho que falta, e o resto fica abaixo para conferir.
  const items = [...inv.items].sort((a, b) => Number(b.resolution === 'UNRESOLVED') - Number(a.resolution === 'UNRESOLVED') || a.itemNumber - b.itemNumber);

  return (
    <section className="space-y-6">
      <BackLink />

      <InvoiceHeader
        inv={inv}
        actions={
          <InvoiceActions
            id={inv.id}
            canManifest={canManifest}
            needsReview={inv.needsReview}
            editable={editable}
            ready={ready}
            unresolvedCount={unresolvedCount}
            firstPending={firstUnresolved(inv.items)}
            hasItems={hasPricing}
          />
        }
      />

      {/* ICMS que a oficina recolhe na entrada em PE: vira conta a pagar só quando a pessoa confirma o vencimento. */}
      <AttentionPanel
        notices={invoiceNotices(inv)}
        alerts={inv.costAlerts ?? []}
        action={(a) =>
          a.amount && Number(a.amount) > 0 && (a.code === 'ST_ENTRADA_PE' || a.code === 'ANTECIPACAO_PE') ? (
            <EntryTaxPayable amount={a.amount} estimated={a.code === 'ANTECIPACAO_PE'} invoiceNumber={inv.number} supplierName={inv.issuerName || 'fornecedor'} />
          ) : null
        }
      />

      <TaxIncidence items={inv.items} collapsible />

      {inv.items.length > 0 ? (
        <>
          <section id="conciliar" aria-labelledby="conciliar-title" className="scroll-mt-24 space-y-3">
            <StepHeading n={1} id="conciliar-title" title="Conciliar itens" hint={unresolvedCount > 0 ? `${unresolvedCount} ${unresolvedCount === 1 ? 'item sem peça' : 'itens sem peça'}` : 'Todos os itens vinculados'} warn={unresolvedCount > 0} />
            <ul className="space-y-3">
              {items.map((item) => (
                <ItemRow key={item.id} invoiceId={inv.id} item={item} editable={editable} />
              ))}
            </ul>
          </section>
          {hasPricing && (
            <div id="precificar" className="scroll-mt-24 space-y-3">
              <PricingPanel invoiceId={inv.id} ready={ready} />
            </div>
          )}
        </>
      ) : (
        <p className="rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center text-sm text-muted-foreground">
          {inv.status === 'SUMMARY' || inv.status === 'MANIFESTED' ? 'Os itens aparecem depois que o XML completo chegar.' : 'Esta nota não tem itens para conciliar.'}
        </p>
      )}
    </section>
  );
}

/** Título de etapa: número, nome e o estado em uma frase (âmbar quando falta algo). */
function StepHeading({ n, id, title, hint, warn }: { n: number; id: string; title: string; hint: string; warn?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
        {n}
      </span>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <span className={warn ? 'rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900' : 'rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800'}>{hint}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/notas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden className="size-4" /> Notas de compra
    </Link>
  );
}
