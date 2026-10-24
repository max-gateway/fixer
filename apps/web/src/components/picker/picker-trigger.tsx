'use client';

import { ChevronRight, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

/**
 * Botão que abre o `SearchDialog` e mostra a escolha atual. Sem escolha: convite tracejado; com escolha: miniatura + rótulo e um X para limpar
 * (botão irmão, não aninhado). Deve ficar dentro do `DialogPrimitive.Root` do seletor.
 */
export function PickerTrigger({
  id,
  placeholder,
  label,
  lead,
  icon,
  clearLabel,
  onClear,
  onWarm,
}: {
  id: string;
  placeholder: string;
  /** Rótulo da escolha atual, ou null se não há. */
  label: string | null;
  /** Miniatura da escolha atual (quando há). */
  lead?: ReactNode;
  /** Ícone do convite (quando não há escolha). */
  icon: ReactNode;
  clearLabel: string;
  onClear: () => void;
  /** Chamado ao chegar perto do botão (hover/foco): bom lugar para aquecer o cache da busca. */
  onWarm?: () => void;
}) {
  const chosen = label !== null;
  return (
    <div className="relative">
      <DialogPrimitive.Trigger asChild>
        <button
          id={id}
          type="button"
          onPointerEnter={onWarm}
          onFocus={onWarm}
          className={cn(
            'group flex w-full items-center gap-3 rounded-lg border bg-background p-2 pr-3 text-left text-sm shadow-xs outline-none transition-[border-color,box-shadow,background-color]',
            'hover:border-brand/50 hover:bg-brand/5 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
            chosen ? 'pr-10' : 'border-dashed',
          )}
        >
          {chosen ? (
            lead
          ) : (
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md bg-brand/10 text-brand transition-transform group-hover:scale-105 [&>svg]:size-5">
              {icon}
            </span>
          )}
          <span className={cn('min-w-0 flex-1 truncate', !chosen && 'text-muted-foreground')}>{label ?? placeholder}</span>
          {!chosen && <Kbd className="hidden sm:inline-flex">Enter</Kbd>}
          {!chosen && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
        </button>
      </DialogPrimitive.Trigger>
      {chosen && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={onClear}
          className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}
