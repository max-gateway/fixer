'use client';

import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Explicação curta de uma etiqueta ou ícone. No mouse e no teclado aparece como dica (Tooltip); no toque, onde dica não
 * existe, o mesmo texto abre num popover. Substitui o atributo `title`, que o celular e o teclado não alcançam.
 */
export function Hint({ content, children, label }: { content: ReactNode; children: ReactNode; /** Nome do botão para leitor de tela, quando o filho não tem texto. */ label?: string }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" aria-label={label} className="inline-flex cursor-help items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {children}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{content}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="w-64 p-3 text-sm">
        {content}
      </PopoverContent>
    </Popover>
  );
}
