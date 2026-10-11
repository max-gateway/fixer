import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_STYLE, type OrderStatus } from '@/lib/orders';

/** Selo de status: bolinha + texto, para o estado nunca depender só da cor. */
export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', s.chip, className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', s.dot)} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Placa estilo Mercosul, só visual. */
export function Plate({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        'tabular inline-flex items-center rounded-[5px] border border-slate-900/70 bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-[0.12em] text-slate-900 shadow-xs',
        className,
      )}
    >
      {value}
    </span>
  );
}
