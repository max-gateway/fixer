import { cn } from 'cn';
import type { ComponentProps } from 'react';

/** Tecla de atalho (keycap). */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-current/20 bg-current/10 px-1 font-sans text-[11px] leading-none font-medium tabular',
        className,
      )}
      {...props}
    />
  );
}
