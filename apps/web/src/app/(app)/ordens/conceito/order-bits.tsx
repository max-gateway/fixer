import { ChevronsUp, Clock, Eye, FileText, Flame, MessageCircle, MessageCircleOff } from 'lucide-react';
import { Hint } from '@/components/hint';
import { UserAvatar } from '@/components/nav/user-avatar';
import { cn } from '@/lib/utils';
import { dueLabel, health, MECHANICS, type Health, type MockOrder, type Priority } from './mock-data';

const HEALTH_STYLE: Record<Health, string> = {
  late: 'bg-red-100 text-red-800 ring-1 ring-red-600/15 ring-inset',
  risk: 'bg-amber-100 text-amber-900 ring-1 ring-amber-600/20 ring-inset',
  ok: 'bg-slate-100 text-slate-600',
  none: '',
};

/** Prazo prometido: ícone + texto + cor, então o atraso nunca depende só da cor. */
export function DueChip({ order, className }: { order: MockOrder; className?: string }) {
  const h = health(order);
  const label = dueLabel(order);
  if (!label || h === 'none') return null;
  const Icon = h === 'late' ? Flame : Clock;
  return (
    <span className={cn('tabular inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', HEALTH_STYLE[h], className)}>
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
      <ChevronsUp aria-hidden className={cn('size-4', urgent ? 'text-red-600' : 'text-amber-600')} />
    </Hint>
  );
}

export function MechanicAvatar({ id, className }: { id: string | null; className?: string }) {
  const m = MECHANICS.find((x) => x.id === id);
  if (!m)
    return (
      <span aria-label="Sem mecânico" className={cn('inline-flex size-6 items-center justify-center rounded-full border border-dashed border-slate-400 text-[10px] text-slate-400', className)}>
        ?
      </span>
    );
  return (
    <span title={m.name}>
      <UserAvatar name={m.name} className={cn('size-6 text-[10px]', className)} />
    </span>
  );
}

/** Sinais de relacionamento com o cliente, em ícones pequenos com explicação. */
export function Signals({ order }: { order: MockOrder }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      {order.whatsappLinked ? (
        <Hint content="WhatsApp vinculado: o cliente recebe os avisos" label="WhatsApp vinculado">
          <MessageCircle aria-hidden className="size-3.5 text-emerald-600" />
        </Hint>
      ) : (
        <Hint content="Sem WhatsApp vinculado. Envie o código OS ao cliente." label="WhatsApp não vinculado">
          <MessageCircleOff aria-hidden className="size-3.5" />
        </Hint>
      )}
      {order.portalViewed && (
        <Hint content="O cliente já abriu o portal desta ordem" label="Portal visualizado">
          <Eye aria-hidden className="size-3.5 text-brand" />
        </Hint>
      )}
      {order.invoice === 'pending' && (
        <Hint content="Nota fiscal pendente de emissão" label="Nota fiscal pendente">
          <FileText aria-hidden className="size-3.5 text-amber-600" />
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
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-[11px] text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}
