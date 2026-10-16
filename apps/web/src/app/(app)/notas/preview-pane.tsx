'use client';

import { ArrowUpRight, CheckCheck, CircleCheck, CircleDashed, CircleSlash, FileDown, Info, Loader2, MousePointerClick, PackageCheck, ShieldCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  describeInvoice,
  FINALITY_LABEL,
  formatCnpj,
  formatKey,
  IGNORED_REASON,
  money,
  nextAction,
  qty,
  shortDate,
  type InvoiceDetail,
  type InvoiceItem,
} from '@/lib/invoices';
import { cn } from '@/lib/utils';
import type { ActionKind } from './hooks';

type Guidance = { tone: 'info' | 'warning' | 'danger'; text: string };

/** Uma frase só, em linguagem de balcão, dizendo o que fazer (ou por que nada). A página completa tem o texto longo. */
function guidance(inv: InvoiceDetail): Guidance | null {
  if (inv.status === 'CANCELED') return inv.exportStatus === 'POSTED' ? { tone: 'danger', text: 'Cancelada pelo fornecedor depois de entrar no estoque. Confira se a mercadoria chegou e, se não, estorne a entrada.' } : { tone: 'info', text: 'O fornecedor cancelou esta nota. Ela não entra no estoque.' };
  if (inv.status === 'IGNORED') return { tone: 'info', text: (inv.ignoredReason && IGNORED_REASON[inv.ignoredReason]) ?? 'Esta nota não é uma compra para a oficina.' };
  if (inv.manifestError && inv.status === 'SUMMARY') return { tone: 'danger', text: `A SEFAZ recusou a ciência: ${inv.manifestError}` };
  if (inv.status === 'SUMMARY') return { tone: 'warning', text: 'Só chegou o resumo. Dê a ciência da operação para a SEFAZ liberar o XML (isso não confirma o recebimento).' };
  if (inv.status === 'MANIFESTED') return { tone: 'info', text: 'Ciência registrada. O XML completo chega na próxima sincronização, em até 1 hora.' };
  if (inv.needsReview) return { tone: 'warning', text: `Nota de finalidade “${inv.finality ? (FINALITY_LABEL[inv.finality] ?? inv.finality) : '—'}”: confira os itens e marque como revisada para seguir.` };
  if (inv.exportStatus === 'POSTED') return { tone: 'info', text: `Entrada lançada no estoque em ${shortDate(inv.postedAt)}.` };
  if (inv.exportStatus === 'READY') return { tone: 'info', text: 'Todos os itens estão vinculados. Lançar a entrada soma as peças ao estoque e atualiza o custo.' };
  return null;
}

const TONE = {
  info: 'border-sky-200 bg-sky-50 text-sky-950',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  danger: 'border-red-200 bg-red-50 text-red-900',
} as const;

function ItemLine({ item }: { item: InvoiceItem }) {
  const Icon = item.resolution === 'UNRESOLVED' ? CircleDashed : item.resolution === 'IGNORED' ? CircleSlash : CircleCheck;
  return (
    <li className="flex items-start gap-2.5 py-2">
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', item.resolution === 'UNRESOLVED' ? 'text-amber-600' : item.resolution === 'IGNORED' ? 'text-muted-foreground' : 'text-emerald-600')} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{item.description}</p>
        <p className="truncate text-xs text-muted-foreground">
          {item.part ? <span className="text-foreground/80">→ {item.part.sku} · {item.part.name}</span> : item.resolution === 'IGNORED' ? 'Ignorado' : `Código ${item.supplierCode}`}
        </p>
      </div>
      <div className="tabular shrink-0 text-right">
        <p className="text-sm">{money(item.totalPrice)}</p>
        <p className="text-xs text-muted-foreground">
          {qty(item.quantity)} {item.unit}
        </p>
      </div>
    </li>
  );
}

export function PreviewEmpty() {
  return (
    <div className="grid h-full min-h-64 place-items-center rounded-xl border border-dashed bg-card/50 p-8 text-center">
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
  detail: InvoiceDetail | undefined;
  loading: boolean;
  error: boolean;
  pending: ActionKind | null;
  canAct: boolean;
  onAction: (kind: ActionKind, inv: InvoiceDetail) => void;
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
  const g = guidance(inv);
  const unresolved = inv.items.filter((i) => i.resolution === 'UNRESOLVED').length;
  const busy = (k: ActionKind) => pending === k;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-4 overflow-y-auto p-5">
        <header className="space-y-1 pr-8">
          <Badge variant={s.tone}>{s.label}</Badge>
          <h2 className="pt-1 text-lg leading-tight font-semibold tracking-tight">{inv.issuerName || 'Fornecedor não identificado'}</h2>
          <p className="text-xs text-muted-foreground">
            {formatCnpj(inv.issuerCnpj)}
            {inv.number != null && ` · NF ${inv.number}${inv.series != null ? `/${inv.series}` : ''}`} · {shortDate(inv.issuedAt)}
          </p>
        </header>

        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border text-sm">
          {[
            ['Valor', money(inv.totalAmount)],
            ['Itens', inv.items.length ? String(inv.items.length) : '—'],
            ['Sem peça', inv.status === 'FULL' ? String(unresolved) : '—'],
          ].map(([k, v]) => (
            <div key={k} className="bg-card px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{k}</dt>
              <dd className={cn('tabular font-semibold', k === 'Sem peça' && unresolved > 0 && 'text-amber-800')}>{v}</dd>
            </div>
          ))}
        </dl>

        {g && (
          <p role={g.tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', TONE[g.tone])}>
            {g.tone === 'info' ? <Info aria-hidden className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <span>{g.text}</span>
          </p>
        )}

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
