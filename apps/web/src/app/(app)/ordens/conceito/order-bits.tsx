import { ChevronsUp, Clock, Eye, FileText, Flame, MessageCircle, MessageCircleOff } from 'lucide-react';
import { Hint } from '@/components/hint';
import { STATUS_LABEL, STATUS_STYLE, type OrderStatus } from '@/lib/orders';
import { cn } from '@/lib/utils';
import { dueLabel, health, MECHANICS, type MockOrder, type Priority } from './mock-data';

/*
 * Paleta do conceito: neutra. Cor só onde ela informa: a bolinha do status, o atraso (vermelho)
 * e a ação principal (azul da marca). O resto é tinta e cinza.
 */

/** Status como texto com bolinha, sem fundo colorido. */
export function StatusLabel({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-slate-700', className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', STATUS_STYLE[status].dot)} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Prazo prometido: ícone + texto. Só o atraso ganha cor. */
export function DueChip({ order, className }: { order: MockOrder; className?: string }) {
  const h = health(order);
  const label = dueLabel(order);
  if (!label || h === 'none') return null;
  const Icon = h === 'late' ? Flame : Clock;
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 text-xs whitespace-nowrap',
        h === 'late' ? 'font-semibold text-red-700' : h === 'risk' ? 'font-semibold text-slate-900' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

export function PriorityMark({ priority }: { priority: Priority }) {
  if (priority === 'normal') return null;
  const urgent = priority === 'urgent';
  return (
    <Hint content={urgent ? 'Urgente: passa na frente de tudo' : 'Prioridade alta'} label={urgent ? 'Prioridade urgente' : 'Prioridade alta'}>
      <ChevronsUp aria-hidden className={cn('size-4', urgent ? 'text-red-600' : 'text-slate-500')} />
    </Hint>
  );
}

/** Iniciais num círculo neutro (sem degradê). */
export function Initials({ name, className }: { name: string; className?: string }) {
  const parts = name.trim().split(/\s+/);
  const text = (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toUpperCase();
  return (
    <span aria-hidden className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 ring-inset select-none', className)}>
      {text}
    </span>
  );
}

export function MechanicAvatar({ id, className }: { id: string | null; className?: string }) {
  const m = MECHANICS.find((x) => x.id === id);
  if (!m)
    return (
      <span title="Sem mecânico" aria-label="Sem mecânico" className={cn('inline-flex size-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-[10px] text-slate-400', className)}>
        ?
      </span>
    );
  return (
    <span title={m.name}>
      <Initials name={m.name} className={className} />
    </span>
  );
}

/** Sinais de relacionamento com o cliente: ícones pequenos, todos no mesmo cinza. */
export function Signals({ order }: { order: MockOrder }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      {order.whatsappLinked ? (
        <Hint content="WhatsApp vinculado: o cliente recebe os avisos" label="WhatsApp vinculado">
          <MessageCircle aria-hidden className="size-3.5 text-slate-500" />
        </Hint>
      ) : (
        <Hint content="Sem WhatsApp vinculado. Envie o código OS ao cliente." label="WhatsApp não vinculado">
          <MessageCircleOff aria-hidden className="size-3.5" />
        </Hint>
      )}
      {order.portalViewed && (
        <Hint content="O cliente já abriu o portal desta ordem" label="Portal visualizado">
          <Eye aria-hidden className="size-3.5 text-slate-500" />
        </Hint>
      )}
      {order.invoice === 'pending' && (
        <Hint content="Nota fiscal pendente de emissão" label="Nota fiscal pendente">
          <FileText aria-hidden className="size-3.5 text-slate-500" />
        </Hint>
      )}
    </span>
  );
}

export function ChecklistBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div role="progressbar" aria-label="Checklist" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-slate-700 transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-[11px] text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}
