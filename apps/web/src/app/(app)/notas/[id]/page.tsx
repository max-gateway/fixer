import { ArrowLeft, Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { ApiError, apiGet } from '@/lib/api';
import type { CostAlert, WithCost, WithCostAlerts } from '@/lib/invoice-cost';
import {
  describeInvoice,
  FINALITY_LABEL,
  formatCnpj,
  formatKey,
  IGNORED_REASON,
  money,
  shortDate,
  type InvoiceDetail,
  type InvoiceItem,
} from '@/lib/invoices';
import { EntryTaxPayable } from './entry-tax-payable';
import { InvoiceActions } from './invoice-actions';
import { PricingPanel } from './pricing-panel';
import { ItemRow } from './item-row';

export const metadata = { title: 'Nota de compra' };

export default async function NotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let inv: Omit<InvoiceDetail, 'items'> & WithCostAlerts & { items: WithCost<InvoiceItem>[] };
  try {
    inv = await apiGet<typeof inv>(`/invoices/${encodeURIComponent(id)}`);
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

  const s = describeInvoice(inv);
  const editable = inv.status === 'FULL' && (inv.exportStatus === 'PENDING_MATCH' || inv.exportStatus === 'READY');
  const unresolved = inv.items.filter((i) => i.resolution === 'UNRESOLVED').length;
  const canManifest = inv.status === 'SUMMARY';

  return (
    <section className="space-y-6">
      <BackLink />

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{inv.issuerName || 'Fornecedor não identificado'}</h1>
            <p className="text-sm text-muted-foreground">
              {formatCnpj(inv.issuerCnpj)}
              {inv.number != null && ` · NF ${inv.number}${inv.series != null ? `/${inv.series}` : ''}`} · emitida em {shortDate(inv.issuedAt)}
            </p>
          </div>
          <Badge variant={s.tone} className="text-sm">
            {s.label}
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Info2 label="Valor da nota" value={money(inv.totalAmount)} />
          <Info2 label="Itens" value={String(inv.items.length || '—')} />
          <Info2 label="Finalidade" value={inv.finality ? (FINALITY_LABEL[inv.finality] ?? String(inv.finality)) : '—'} />
          <Info2 label="Sem peça" value={inv.status === 'FULL' ? String(unresolved) : '—'} />
        </dl>
        <p className="tabular text-xs break-all text-muted-foreground">Chave de acesso: {formatKey(inv.accessKey)}</p>
        <InvoiceActions id={inv.id} hasXml={inv.hasXml} canManifest={canManifest} needsReview={inv.needsReview} editable={editable} ready={editable && inv.exportStatus === 'READY' && !inv.needsReview} />
      </header>

      <Notices inv={inv} />
      <CostAlerts alerts={inv.costAlerts ?? []} invoiceNumber={inv.number} supplierName={inv.issuerName} />

      {inv.items.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Itens</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {inv.items.map((item) => (
              <ItemRow key={item.id} invoiceId={inv.id} item={item} editable={editable} />
            ))}
          </ul>
          {editable && inv.items.some((i) => i.resolution !== 'UNRESOLVED' && i.resolution !== 'IGNORED') && (
            <div className="pt-4">
              <PricingPanel invoiceId={inv.id} ready={inv.exportStatus === 'READY' && !inv.needsReview} />
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed bg-card/60 px-6 py-10 text-center text-sm text-muted-foreground">
          {inv.status === 'SUMMARY' || inv.status === 'MANIFESTED' ? 'Os itens aparecem depois que o XML completo chegar.' : 'Esta nota não tem itens para conciliar.'}
        </p>
      )}
    </section>
  );
}

/** O que o XML não traz ou não fecha (frete por fora, antecipação de ICMS, item que não é revenda), com os itens envolvidos. */
function CostAlerts({ alerts, invoiceNumber, supplierName }: { alerts: CostAlert[]; invoiceNumber: number | null; supplierName: string }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-3">
      {alerts.map((a, i) => (
        <Notice key={`${a.code}-${i}`} tone={a.severity === 'warning' ? 'warning' : 'info'}>
          <p>{a.message}</p>
          {a.itemNumbers.length > 0 && <p className="text-xs">Itens: {a.itemNumbers.join(', ')}</p>}
          {/* ICMS que a oficina recolhe na entrada em PE: vira conta a pagar só quando a pessoa confirma o vencimento. */}
          {a.amount && Number(a.amount) > 0 && (a.code === 'ST_ENTRADA_PE' || a.code === 'ANTECIPACAO_PE') && (
            <EntryTaxPayable amount={a.amount} estimated={a.code === 'ANTECIPACAO_PE'} invoiceNumber={invoiceNumber} supplierName={supplierName || 'fornecedor'} />
          )}
        </Notice>
      ))}
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

function Info2({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warning' | 'danger' | 'info'; children: React.ReactNode }) {
  const style = {
    warning: 'border-amber-200 bg-amber-50 text-amber-950',
    danger: 'border-red-200 bg-red-50 text-red-900',
    info: 'border-sky-200 bg-sky-50 text-sky-950',
  }[tone];
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${style}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Tudo o que a pessoa precisa saber para decidir, em linguagem de balcão e não de status de sistema. */
function Notices({ inv }: { inv: InvoiceDetail }) {
  return (
    <div className="space-y-3 empty:hidden">
      {inv.status === 'CANCELED' && inv.exportStatus === 'POSTED' && (
        <Notice tone="danger">
          <p className="font-semibold">Esta nota foi cancelada pelo fornecedor depois de entrar no estoque.</p>
          <p>As peças já estão no estoque. Confira se foram recebidas e, se não, estorne a entrada.</p>
        </Notice>
      )}
      {inv.status === 'CANCELED' && inv.exportStatus !== 'POSTED' && (
        <Notice tone="info">
          <p>O fornecedor cancelou esta nota. Ela não entra no estoque.</p>
        </Notice>
      )}
      {inv.status === 'IGNORED' && (
        <Notice tone="info">
          <p>{(inv.ignoredReason && IGNORED_REASON[inv.ignoredReason]) ?? 'Esta nota não é uma compra para a oficina.'}</p>
          <p>O XML fica guardado, mas ela não entra no estoque.</p>
        </Notice>
      )}
      {inv.status === 'SUMMARY' && (
        <Notice tone="warning">
          <p className="font-semibold">Só chegou o resumo da nota.</p>
          <p>Para a SEFAZ liberar o XML completo, é preciso dar a ciência da operação. Isso não confirma o recebimento da mercadoria.</p>
        </Notice>
      )}
      {inv.status === 'MANIFESTED' && (
        <Notice tone="info">
          <p>Ciência registrada. O XML completo chega na próxima sincronização, em até 1 hora.</p>
        </Notice>
      )}
      {inv.manifestError && inv.status === 'SUMMARY' && (
        <Notice tone="danger">
          <p className="font-semibold">A SEFAZ recusou a ciência desta nota.</p>
          <p>{inv.manifestError}</p>
          {inv.manifestAttempts >= 5 && <p>Esgotadas as tentativas automáticas. Use “Dar ciência e baixar XML” para tentar de novo.</p>}
        </Notice>
      )}
      {inv.needsReview && inv.status === 'FULL' && (
        <Notice tone="warning">
          <p className="font-semibold">Nota de finalidade “{inv.finality ? (FINALITY_LABEL[inv.finality] ?? inv.finality) : '—'}”.</p>
          <p>O sistema não decide sozinho o efeito dela no estoque. Confira os itens e use “Revisei esta nota” para seguir.</p>
        </Notice>
      )}
      {inv.exportStatus === 'POSTED' && inv.status === 'FULL' && (
        <Notice tone="info">
          <p>Entrada lançada no estoque em {shortDate(inv.postedAt)}.</p>
        </Notice>
      )}
      {inv.status === 'FULL' && inv.exportStatus === 'READY' && (
        <Notice tone="info">
          <p>Todos os itens estão resolvidos. Confira e use “Lançar entrada no estoque” para somar as peças ao estoque e atualizar o custo.</p>
        </Notice>
      )}
    </div>
  );
}
