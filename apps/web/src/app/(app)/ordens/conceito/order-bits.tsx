import { ChevronsUp, Clock, Flame } from 'lucide-react';
import { Hint } from '@/components/hint';
import { STATUS_LABEL, STATUS_STYLE, type OrderStatus } from '@/lib/orders';
import { cn } from '@/lib/utils';
import { dueLabel, health, MECHANICS, type MockOrder, type Priority } from './mock-data';

/*
 * Linguagem da logo: preto profundo, azul elétrico e o traço inclinado do "E" de FIXER.
 * Azul marca o que é da oficina fazer; vermelho, só o atraso. O resto é tinta e cinza-azulado.
 */

/** O traço inclinado da logo. Abre cada grupo e marca a linha que pede ação. */
export function Slash({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block h-1.5 w-7 -skew-x-[35deg] rounded-[2px] bg-brand', className)} />;
}

/** Placa Mercosul em miniatura: a faixa azul faz o carro ser reconhecido de relance na lista. */
export function PlateMark({ value, size = 'md', className }: { value: string; size?: 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-label={`Placa ${value}`}
      className={cn('inline-flex shrink-0 flex-col overflow-hidden rounded-md border-2 border-[#0f141b] bg-white shadow-xs', className)}
    >
      <span aria-hidden className={cn('bg-[#1d3f9f] text-center font-bold tracking-[0.3em] text-white', size === 'lg' ? 'py-0.5 text-[8px]' : 'h-1.5 text-[0px]')}>
        BRASIL
      </span>
      <span className={cn('tabular font-mono font-bold tracking-[0.14em] text-[#0f141b]', size === 'lg' ? 'px-3 py-1 text-xl' : 'px-1.5 py-0.5 text-[13px] leading-tight')}>{value}</span>
    </span>
  );
}

/** Status como texto com bolinha, sem fundo colorido. */
export function StatusLabel({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', className)}>
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

/** Iniciais num círculo em tinta da marca. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const parts = name.trim().split(/\s+/);
  const text = (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toUpperCase();
  return (
    <span aria-hidden className={cn('font-display inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-secondary text-[10px] font-semibold text-white select-none', className)}>
      {text}
    </span>
  );
}

/** Mecânico pelo primeiro nome; sem ninguém, um aviso discreto. */
export function MechanicName({ id, className }: { id: string | null; className?: string }) {
  const m = MECHANICS.find((x) => x.id === id);
  if (!m) return <span className={cn('text-xs text-muted-foreground italic', className)}>sem mecânico</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-slate-700', className)}>
      <Initials name={m.name} className="size-5 text-[9px]" />
      {m.name.split(' ')[0]}
    </span>
  );
}

export function ChecklistBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div role="progressbar" aria-label="Checklist" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-[11px] text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}
