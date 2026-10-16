import type { ComponentProps } from 'react';
import { describedBy } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

/**
 * Campo numérico com a unidade à vista: "R$" antes do valor em dinheiro, "%" depois do percentual. Liga o erro e a dica ao
 * input como o `Field` espera (`aria-describedby`).
 */
export function UnitInput({
  id,
  unit,
  side = 'end',
  error,
  hint,
  className,
  ...input
}: Omit<ComponentProps<'input'>, 'id'> & { id: string; unit: string; side?: 'start' | 'end'; error?: string | null; hint?: boolean; className?: string }) {
  return (
    <InputGroup className={cn('max-w-40', className)} aria-invalid={error ? true : undefined}>
      {side === 'start' && <InputGroupAddon align="start">{unit}</InputGroupAddon>}
      <InputGroupInput inputMode="decimal" {...describedBy(id, error, hint)} {...input} />
      {side === 'end' && <InputGroupAddon align="end">{unit}</InputGroupAddon>}
    </InputGroup>
  );
}
