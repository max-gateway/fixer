'use client';

import { Check, ChevronRight, Copy, FileText, Paperclip, Receipt, Repeat } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  civilDate,
  civilShort,
  civilWeekday,
  describePayable,
  groupRows,
  initials,
  METHOD_LABEL,
  money,
  relativeDue,
  type Filters,
  type Group,
  type PayableRow,
} from '@/lib/payables';
import { cn } from '@/lib/utils';

type Handlers = {
  onOpen: (id: string) => void;
  onToggle: (id: string, shift: boolean) => void;
  onPay: (row: PayableRow) => void;
  onCopyBarcode: (row: PayableRow) => void;
};

export function PayableList({
  rows,
  filters,
  today,
  selected,
  focusedId,
  loading,
  hasFilters,
  onClearFilters,
  onNew,
  ...handlers
}: {
  rows: PayableRow[];
  filters: Filters;
  today: string;
  selected: ReadonlySet<string>;
  focusedId: string | null;
  loading: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
  onNew: () => void;
} & Handlers) {
  const groups = useMemo(() => groupRows(rows, filters.group, today), [rows, filters.group, today]);

  if (rows.length === 0) return <Empty filtered={hasFilters || !!filters.q} view={filters.view} onClear={onClearFilters} onNew={onNew} />;

  return (
    <div className={cn('space-y-5 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
      {groups.map((g) => (
        <GroupBlock key={g.key} group={g} showHeader={filters.group !== 'none'} today={today} selected={selected} focusedId={focusedId} {...handlers} />
      ))}
    </div>
  );
}

function GroupBlock({ group, showHeader, today, selected, focusedId, ...handlers }: { group: Group; showHeader: boolean; today: string; selected: ReadonlySet<string>; focusedId: string | null } & Handlers) {
  const allIds = group.rows.map((r) => r.id);
  const selectedHere = allIds.filter((id) => selected.has(id)).length;
  return (
    <section aria-label={group.label}>
      {showHeader && (
        <header className="sticky top-16 z-10 -mx-1 mb-1.5 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur-sm">
          <h3 className={cn('text-sm font-semibold capitalize', group.tone === 'danger' && 'text-red-800', group.tone === 'warning' && 'text-amber-800')}>{group.label}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular">{group.rows.length}</span>
          {selectedHere > 0 && <span className="text-xs text-brand">{selectedHere} selecionada{selectedHere > 1 ? 's' : ''}</span>}
          <span className="tabular ml-auto text-sm font-medium text-muted-foreground">{money(group.amount)}</span>
        </header>
      )}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
        {group.rows.map((r) => (
          <Row key={r.id} row={r} today={today} selected={selected.has(r.id)} focused={focusedId === r.id} {...handlers} />
        ))}
      </ul>
    </section>
  );
}

const Row = memo(function Row({
  row: p,
  today,
  selected,
  focused,
  onOpen,
  onToggle,
  onPay,
  onCopyBarcode,
}: { row: PayableRow; today: string; selected: boolean; focused: boolean } & Handlers) {
  const s = describePayable(p, today);
  const open = p.status === 'OPEN';
  const overdue = open && s.tone === 'danger';
  const meta = [p.documentNumber && `Doc ${p.documentNumber}`, p.installmentCount > 1 && `${p.installment}/${p.installmentCount}`, p.description].filter(Boolean);

  return (
    <li
      data-row-id={p.id}
      aria-selected={selected}
      className={cn(
        'group/row relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 transition-colors sm:grid-cols-[auto_minmax(0,1.7fr)_9rem_9rem_7.5rem] sm:px-4',
        'hover:bg-muted/50',
        selected && 'bg-brand-soft hover:bg-brand-soft',
        focused && 'ring-2 ring-inset ring-brand/60',
      )}
    >
      {overdue && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5" style={{ backgroundColor: '#d03b3b' }} />}

      <label className="grid size-6 cursor-pointer place-items-center self-start sm:self-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {}}
          onClick={(e) => onToggle(p.id, e.shiftKey)}
          aria-label={`Selecionar conta de ${p.supplierName}`}
          className="size-4 cursor-pointer rounded accent-[var(--brand-primary)]"
        />
      </label>

      <button type="button" onClick={() => onOpen(p.id)} className="col-span-1 flex min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-xs font-semibold text-secondary-foreground">
          {initials(p.supplierName)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{p.supplierName || 'Fornecedor não identificado'}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {p.invoice && <FileText aria-label="Veio de nota fiscal" className="size-3 shrink-0" />}
            {p.installmentCount > 1 && <Repeat aria-hidden className="size-3 shrink-0" />}
            <span className="truncate">{meta.join(' · ') || (p.source === 'MANUAL' ? 'Lançamento avulso' : 'Nota fiscal')}</span>
            {p.barcode && <Paperclip aria-label="Tem linha digitável" className="size-3 shrink-0" />}
          </span>
        </span>
      </button>

      {/* mobile: valor à direita do fornecedor; desktop: colunas próprias */}
      <span className="tabular col-start-3 row-start-1 text-right text-sm font-semibold sm:hidden">{money(p.status === 'PAID' && p.paidAmount ? p.paidAmount : p.amount)}</span>

      <div className="col-start-2 col-end-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:col-auto sm:block sm:space-y-0.5">
        <span className={cn('tabular block text-sm', overdue && 'font-medium text-red-800')}>
          {p.status === 'PAID' ? `Paga ${civilShort(p.paidAt!)}` : `${civilWeekday(p.dueDate)}, ${civilShort(p.dueDate)}`}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:block">
          {open ? relativeDue(p.dueDate, today) : p.status === 'PAID' ? (p.paymentMethod ? (METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod) : 'pagamento registrado') : 'cancelada'}
        </span>
        <span className="sm:hidden">
          <Badge variant={s.tone}>{s.label}</Badge>
        </span>
        {p.category && <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground sm:hidden">{p.category}</span>}
      </div>

      <div className="hidden min-w-0 sm:block">
        <Badge variant={s.tone}>{s.label}</Badge>
        {p.category && <span className="mt-1 block truncate text-xs text-muted-foreground">{p.category}</span>}
      </div>

      <div className="hidden items-center justify-end gap-1 sm:flex">
        <span className="tabular mr-1 text-sm font-semibold">
          {money(p.status === 'PAID' && p.paidAmount ? p.paidAmount : p.amount)}
          {p.status === 'PAID' && p.paidAmount && p.paidAmount !== p.amount && <span className="block text-right text-[11px] font-normal text-muted-foreground">prev. {money(p.amount)}</span>}
        </span>
      </div>

      {/* ações de linha: aparecem ao passar o mouse / focar (teclado) */}
      <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-1 rounded-lg border bg-card p-1 shadow-sm group-focus-within/row:flex group-hover/row:flex sm:right-[9.75rem]">
        {p.barcode && open && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Copiar linha digitável" title="Copiar linha digitável" onClick={() => onCopyBarcode(p)}>
            <Copy aria-hidden />
          </Button>
        )}
        {open && (
          <Button type="button" size="sm" onClick={() => onPay(p)} title="Pagar (P)">
            <Check aria-hidden /> Pagar
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Abrir detalhes" onClick={() => onOpen(p.id)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </li>
  );
});

function Empty({ filtered, view, onClear, onNew }: { filtered: boolean; view: Filters['view']; onClear: () => void; onNew: () => void }) {
  const copy = filtered
    ? { title: 'Nada com esses filtros', hint: 'Tente outro termo ou limpe os filtros.' }
    : view === 'overdue'
      ? { title: 'Nenhuma conta vencida', hint: 'Tudo em dia. É assim que se mantém um bom nome com os fornecedores.' }
      : view === 'paid'
        ? { title: 'Nenhum pagamento registrado', hint: 'As contas pagas ficam aqui, com valor, data e forma de pagamento.' }
        : view === 'canceled'
          ? { title: 'Nenhuma conta cancelada', hint: 'Contas de notas canceladas pelo fornecedor ou descartadas aparecem aqui.' }
          : { title: 'Nenhuma conta por aqui', hint: 'As parcelas das notas de compra chegam sozinhas, direto das duplicatas do XML. Para o que não vem em nota, lance à mão.' };
  return (
    <div className="grid place-items-center gap-4 rounded-xl border border-dashed bg-card/60 px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Receipt aria-hidden className="size-6" />
      </span>
      <div>
        <p className="font-semibold">{copy.title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{copy.hint}</p>
      </div>
      {filtered ? (
        <Button variant="outline" size="sm" onClick={onClear}>
          Limpar filtros
        </Button>
      ) : view === 'open' || view === 'all' ? (
        <Button size="sm" onClick={onNew}>
          Nova conta
        </Button>
      ) : null}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="skeleton size-6 rounded" />
          <div className="skeleton size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/3 rounded" />
            <div className="skeleton h-3 w-1/5 rounded" />
          </div>
          <div className="skeleton h-4 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

export { civilDate };
