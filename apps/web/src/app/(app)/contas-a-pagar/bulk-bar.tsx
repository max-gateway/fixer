'use client';

import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/payables';

/** Barra flutuante da seleção: total em tela, pagar tudo de uma vez, cancelar ou limpar. */
export function BulkBar({
  count,
  amount,
  canPay,
  canManage,
  onPay,
  onCancel,
  onClear,
}: {
  count: number;
  amount: string;
  canPay: boolean;
  canManage: boolean;
  onPay: () => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
      <div
        role="region"
        aria-label="Ações da seleção"
        className="pointer-events-auto flex max-w-full animate-rise items-center gap-3 rounded-2xl border bg-foreground px-4 py-2.5 text-background shadow-xl"
      >
        <div className="min-w-0 pr-1">
          <p className="text-sm font-semibold">
            {count} {count === 1 ? 'conta' : 'contas'}
          </p>
          <p aria-live="polite" className="tabular text-xs text-background/70">
            {money(amount)}
          </p>
        </div>
        {canPay && (
          <Button size="sm" onClick={onPay}>
            <Check aria-hidden /> Pagar
          </Button>
        )}
        {canManage && (
          <Button size="sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" onClick={onCancel}>
            Cancelar contas
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" aria-label="Limpar seleção" onClick={onClear}>
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}
