'use client';

import { Check, FileDown, FileText, SearchX } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { describeInvoice, formatCnpj, groupByDay, hueOf, initials, money, nextAction, resolvedRatio, shortDate, sumTotals, type InvoiceRow, type View } from '@/lib/invoices';
import { cn } from '@/lib/utils';

const EMPTY: Record<View, { title: string; hint: string }> = {
  pending: { title: 'Nada para conciliar', hint: 'Quando chegar uma nota com itens ainda sem peça, ela aparece aqui.' },
  ready: { title: 'Nenhuma nota pronta', hint: 'Notas com todos os itens vinculados aparecem aqui, prontas para lançar no estoque.' },
  posted: { title: 'Nenhuma nota lançada', hint: 'As entradas já lançadas no estoque ficam aqui.' },
  summary: { title: 'Nenhuma nota sem XML', hint: 'Notas que só chegaram como resumo, aguardando a ciência da operação.' },
  canceled: { title: 'Nenhuma nota cancelada', hint: 'Notas canceladas pelo fornecedor aparecem aqui.' },
  ignored: { title: 'Nenhuma nota ignorada', hint: 'Notas que não são compras para o CNPJ da oficina aparecem aqui.' },
  all: { title: 'Nenhuma nota ainda', hint: 'Quando o certificado digital da empresa estiver configurado, as notas chegam aqui automaticamente.' },
};

/** Anel de progresso da conciliação: quantos itens da nota já têm peça. */
function Ring({ ratio }: { ratio: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const done = ratio >= 1;
  return (
    <span className="relative grid size-6 shrink-0 place-items-center" role="img" aria-label={`${Math.round(ratio * 100)}% dos itens vinculados`}>
      <svg viewBox="0 0 24 24" className="size-6 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          className={cn('transition-[stroke-dashoffset] duration-500', done ? 'stroke-emerald-500' : 'stroke-brand')}
        />
      </svg>
      {done && <Check aria-hidden className="absolute size-3 text-emerald-600" />}
    </span>
  );
}

const Row = memo(function Row({
  n,
  active,
  focused,
  checked,
  anySelected,
  onOpen,
  onToggle,
  onHover,
}: {
  n: InvoiceRow;
  active: boolean;
  focused: boolean;
  checked: boolean;
  anySelected: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string, shift: boolean) => void;
  onHover: (id: string) => void;
}) {
  const s = describeInvoice(n);
  const ratio = resolvedRatio(n);
  const action = nextAction(n);
  const hue = hueOf(n.issuerCnpj || n.issuerName);
  return (
    <li
      data-row-id={n.id}
      onMouseEnter={() => onHover(n.id)}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2.5 transition-colors sm:px-4',
        active ? 'bg-brand-soft' : checked ? 'bg-muted/70' : 'hover:bg-muted/50',
        focused && 'ring-2 ring-brand/60 ring-inset',
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand" />}

      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`Selecionar nota de ${n.issuerName || 'fornecedor não identificado'}`}
        onClick={(e) => onToggle(n.id, e.shiftKey)}
        className="relative grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        style={{ background: `oklch(0.94 0.04 ${hue})`, color: `oklch(0.38 0.09 ${hue})` }}
      >
        <span className={cn('transition-opacity', checked || anySelected ? 'opacity-0' : 'group-hover:opacity-0')}>{initials(n.issuerName || '?')}</span>
        <span
          className={cn(
            'absolute inset-0 grid place-items-center rounded-lg border-2 transition-opacity',
            checked ? 'border-brand bg-brand text-white opacity-100' : cn('border-foreground/25 bg-background', anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'),
          )}
        >
          {checked && <Check aria-hidden className="size-4" />}
        </span>
      </button>

      <button type="button" onClick={() => onOpen(n.id)} className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 text-left focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_auto_6.5rem]">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{n.issuerName || 'Fornecedor não identificado'}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {n.number != null ? `NF ${n.number}${n.series != null ? `/${n.series}` : ''} · ` : ''}
            {formatCnpj(n.issuerCnpj)} · {shortDate(n.issuedAt)}
          </span>
        </span>
        <span className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end sm:col-start-2">
          {n.manifestError && <Badge variant="danger">ciência recusada</Badge>}
          {ratio !== null && n.exportStatus !== 'POSTED' && (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
              <Ring ratio={ratio} />
              {n.unresolvedCount > 0 ? `${n.unresolvedCount} sem peça` : `${n.itemCount} ${n.itemCount === 1 ? 'item' : 'itens'}`}
            </span>
          )}
          <Badge variant={s.tone} className={cn(action && 'sm:ring-1 sm:ring-current/20')}>
            {s.label}
          </Badge>
        </span>
        <span className="tabular col-start-2 row-start-2 justify-self-end text-sm font-medium sm:col-start-3 sm:row-start-1 sm:text-right">{money(n.totalAmount)}</span>
      </button>
    </li>
  );
});

export function InvoiceList({
  rows,
  view,
  filtered,
  loading,
  activeId,
  focusedId,
  selected,
  onOpen,
  onToggle,
  onHover,
}: {
  rows: InvoiceRow[];
  view: View;
  filtered: boolean;
  loading: boolean;
  activeId: string | null;
  focusedId: string | null;
  selected: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onToggle: (id: string, shift: boolean) => void;
  onHover: (id: string) => void;
}) {
  const groups = useMemo(() => groupByDay(rows), [rows]);

  if (rows.length === 0) {
    const e = filtered ? { title: 'Nenhuma nota com essa busca', hint: 'Tente outro termo ou troque de etapa.' } : EMPTY[view];
    const Icon = filtered ? SearchX : view === 'all' ? FileDown : FileText;
    return (
      <div className={cn('grid place-items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-16 text-center', loading && 'opacity-60')}>
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon aria-hidden className="size-6" />
        </span>
        <div>
          <p className="font-semibold">{e.title}</p>
          <p className="max-w-md text-sm text-muted-foreground">{e.hint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card shadow-xs transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h3 className="sticky top-0 z-10 flex items-baseline justify-between border-b bg-muted/80 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">
            <span>{g.label}</span>
            <span className="tabular font-normal tracking-normal normal-case">
              {g.rows.length} · {money(sumTotals(g.rows))}
            </span>
          </h3>
          <ul className="divide-y">
            {g.rows.map((n) => (
              <Row key={n.id} n={n} active={n.id === activeId} focused={n.id === focusedId} checked={selected.has(n.id)} anySelected={selected.size > 0} onOpen={onOpen} onToggle={onToggle} onHover={onHover} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
